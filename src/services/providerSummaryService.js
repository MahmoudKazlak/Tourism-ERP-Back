import mongoose from "mongoose";
import providerModel from "../../DB/model/provider.model.js";

// ── Shared balance helper ─────────────────────────────────────────────────────

/**
 * Derives balance type and display label from a numeric balance.
 * Single source of truth — used by resyncProviderSummary.
 * The buildSummaryPipeline uses equivalent MongoDB expression syntax.
 */
export const computeBalanceInfo = (currentBalance) => {
  if (currentBalance > 0.01) {
    return {
      balanceType:  "we_owe_provider",
      balanceLabel: `Agency owes provider: $${currentBalance.toFixed(2)}`,
    };
  }
  if (currentBalance < -0.01) {
    return {
      balanceType:  "provider_owes_us",
      balanceLabel: `Provider owes agency: $${Math.abs(currentBalance).toFixed(2)}`,
    };
  }
  return {
    balanceType:  "settled",
    balanceLabel: "Account settled — no outstanding balance",
  };
};

// ── Sync failure recorder ─────────────────────────────────────────────────────

/**
 * Persists a provider summary drift event to the SyncFailure collection.
 *
 * Called from the catch block in applyProviderSummaryDelta so that every
 * drift event creates a queryable record instead of disappearing into logs.
 * Admins can find unresolved failures and trigger a targeted resync.
 *
 * This function never throws — a failure to record the failure should not
 * create a recursive error chain.
 */
const recordSyncFailure = async ({ providerId, source, delta, errorMessage }) => {
  try {
    const SyncFailure = mongoose.model("SyncFailure");
    await SyncFailure.create({ providerId, source, delta, errorMessage });
  } catch (persistErr) {
    // If even the failure record can't be written, we've hit a serious DB
    // issue. Log to stderr so it at least shows up in any log aggregator.
    console.error(
      "❌ CRITICAL: Could not persist SyncFailure record.",
      "Original error:", errorMessage,
      "Persist error:",  persistErr.message,
    );
  }
};

export { recordSyncFailure };

// ── Incremental delta pipeline (MongoDB aggregation-pipeline expression) ───────

const buildSummaryPipeline = (delta) => {
  const inc = (field, amount) => ({
    $add: [{ $ifNull: [`$summary.${field}`, 0] }, amount],
  });

  return [
    {
      $set: {
        "summary.totalBuy":                   inc("totalBuy",                   delta.totalBuy                   ?? 0),
        "summary.totalSell":                  inc("totalSell",                  delta.totalSell                  ?? 0),
        "summary.totalWeHavePaid":            inc("totalWeHavePaid",            delta.totalWeHavePaid            ?? 0),
        "summary.totalCustomersPaidDirect":   inc("totalCustomersPaidDirect",   delta.totalCustomersPaidDirect   ?? 0),
        "summary.totalCollectedFromProvider": inc("totalCollectedFromProvider",  delta.totalCollectedFromProvider ?? 0),
        "summary.lastSynced":                 new Date(),
      },
    },
    {
      $set: {
        "summary.totalCredits": {
          $add: ["$summary.totalWeHavePaid", "$summary.totalCustomersPaidDirect"],
        },
        "summary.currentBalance": {
          $subtract: [
            { $add: ["$summary.totalBuy", "$summary.totalCollectedFromProvider"] },
            { $add: ["$summary.totalWeHavePaid", "$summary.totalCustomersPaidDirect"] },
          ],
        },
      },
    },
    {
      $set: {
        "summary.balanceType": {
          $switch: {
            branches: [
              { case: { $gt: ["$summary.currentBalance",  0.01] }, then: "we_owe_provider"  },
              { case: { $lt: ["$summary.currentBalance", -0.01] }, then: "provider_owes_us" },
            ],
            default: "settled",
          },
        },
        "summary.balanceLabel": {
          $cond: {
            if:   { $gt: ["$summary.currentBalance", 0.01] },
            then: { $concat: ["Agency owes provider: $", { $toString: { $round: ["$summary.currentBalance", 2] } }] },
            else: {
              $cond: {
                if:   { $lt: ["$summary.currentBalance", -0.01] },
                then: { $concat: ["Provider owes agency: $", { $toString: { $round: [{ $abs: "$summary.currentBalance" }, 2] } }] },
                else: "Account settled — no outstanding balance",
              },
            },
          },
        },
      },
    },
  ];
};

// ── Incremental delta update ──────────────────────────────────────────────────

/**
 * Applies an incremental financial delta to a provider's summary.
 *
 * Error handling (Phase 4):
 *   On failure, the event is written to the SyncFailure collection so it
 *   can be detected and recovered via the resync endpoint. The error is also
 *   logged to stderr. This replaces the previous console.error-only approach.
 *
 * @param {string|ObjectId} providerId
 * @param {object} delta - Fields to increment (all optional, default 0).
 * @param {string} [source] - Identifies which hook triggered this call.
 */
export const applyProviderSummaryDelta = async (providerId, delta, source = "unknown") => {
  if (!providerId) return;

  const hasChange = Object.values(delta).some((v) => v !== 0);
  if (!hasChange) return;

  try {
    await providerModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(providerId.toString()) },
      buildSummaryPipeline(delta),
    );
  } catch (err) {
    console.error(
      `❌ providerSummaryService [${source}]: delta update failed for provider ${providerId}:`,
      err.message,
    );

    // Persist the failure for admin monitoring and resync targeting.
    // The booking/payment is already committed — this records the drift so
    // it can be detected and resolved without relying on log monitoring.
    await recordSyncFailure({
      providerId: providerId.toString(),
      source,
      delta,
      errorMessage: err.message,
    });
  }
};

// ── Delta extraction from a booking document ──────────────────────────────────

export const computeServiceDeltas = (booking) => {
  const map = new Map();
  for (const service of booking.services || []) {
    if (!service.provider) continue;
    const k   = service.provider.toString();
    const cur = map.get(k) || { buy: 0, sell: 0 };
    map.set(k, {
      buy:  cur.buy  + (Number(service.buy)  || 0),
      sell: cur.sell + (Number(service.sell) || 0),
    });
  }
  return map;
};

// ── Full resync ───────────────────────────────────────────────────────────────

export const resyncProviderSummary = async (providerId) => {
  const Booking            = mongoose.model("Booking");
  const ProviderPayment    = mongoose.model("ProviderPayment");
  const Payment            = mongoose.model("Payment");
  const ProviderCollection = mongoose.model("ProviderCollection");
  const SyncFailure        = mongoose.model("SyncFailure");

  const providerObjId = new mongoose.Types.ObjectId(providerId);

  const [bookingAgg, provPayAgg, directPayAgg, collectionAgg] = await Promise.all([
    Booking.aggregate([
      { $match:  { "services.provider": providerObjId } },
      { $unwind: "$services" },
      { $match:  { "services.provider": providerObjId } },
      { $group:  { _id: null, totalBuy: { $sum: "$services.buy" }, totalSell: { $sum: "$services.sell" } } },
    ]),
    ProviderPayment.aggregate([
      { $match: { provider: providerObjId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { providerRecipient: providerObjId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    ProviderCollection.aggregate([
      { $match: { provider: providerObjId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const totalBuy                   = bookingAgg[0]?.totalBuy  ?? 0;
  const totalSell                  = bookingAgg[0]?.totalSell ?? 0;
  const totalWeHavePaid            = provPayAgg[0]?.total     ?? 0;
  const totalCustomersPaidDirect   = directPayAgg[0]?.total   ?? 0;
  const totalCollectedFromProvider = collectionAgg[0]?.total  ?? 0;

  const totalCredits   = totalWeHavePaid + totalCustomersPaidDirect;
  const currentBalance = totalBuy - totalCredits + totalCollectedFromProvider;
  const { balanceType, balanceLabel } = computeBalanceInfo(currentBalance);

  await providerModel.findByIdAndUpdate(providerId, {
    $set: {
      "summary.totalBuy":                   totalBuy,
      "summary.totalSell":                  totalSell,
      "summary.totalWeHavePaid":            totalWeHavePaid,
      "summary.totalCustomersPaidDirect":   totalCustomersPaidDirect,
      "summary.totalCollectedFromProvider": totalCollectedFromProvider,
      "summary.totalCredits":               totalCredits,
      "summary.currentBalance":             currentBalance,
      "summary.balanceType":                balanceType,
      "summary.balanceLabel":               balanceLabel,
      "summary.lastSynced":                 new Date(),
    },
  });

  // Mark all unresolved SyncFailure records for this provider as resolved
  await SyncFailure.updateMany(
    { providerId: providerObjId, resolved: false },
    { $set: { resolved: true, resolvedAt: new Date() } },
  );

  return {
    totalBuy, totalSell, totalWeHavePaid,
    totalCustomersPaidDirect, totalCollectedFromProvider,
    totalCredits, currentBalance, balanceType, balanceLabel,
  };
};
