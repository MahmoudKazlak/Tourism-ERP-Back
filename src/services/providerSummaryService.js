import mongoose from "mongoose";
import providerModel from "../../DB/model/provider.model.js";

// ── Shared balance helper ─────────────────────────────────────────────────────

/**
 * Derives balance type and display label from a numeric balance.
 *
 * This is the single source of truth for balance classification in JS.
 * The buildSummaryPipeline uses equivalent MongoDB expression syntax for
 * the same logic on the delta-update (incremental) path.
 *
 * Exported so future consumers (e.g. a reporting service) can use it
 * without duplicating the thresholds or label strings.
 *
 * @param {number} currentBalance
 * @returns {{ balanceType: string, balanceLabel: string }}
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

// ── Incremental delta pipeline (MongoDB expression syntax) ────────────────────

const buildSummaryPipeline = (delta) => {
  const inc = (field, amount) => ({
    $add: [{ $ifNull: [`$summary.${field}`, 0] }, amount],
  });

  return [
    {
      $set: {
        "summary.totalBuy":                  inc("totalBuy",                  delta.totalBuy                  ?? 0),
        "summary.totalSell":                 inc("totalSell",                 delta.totalSell                 ?? 0),
        "summary.totalWeHavePaid":           inc("totalWeHavePaid",           delta.totalWeHavePaid           ?? 0),
        "summary.totalCustomersPaidDirect":  inc("totalCustomersPaidDirect",  delta.totalCustomersPaidDirect  ?? 0),
        "summary.totalCollectedFromProvider":inc("totalCollectedFromProvider", delta.totalCollectedFromProvider ?? 0),
        "summary.lastSynced":                new Date(),
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

export const applyProviderSummaryDelta = async (providerId, delta) => {
  if (!providerId) return;

  const hasChange = Object.values(delta).some((v) => v !== 0);
  if (!hasChange) return;

  try {
    await providerModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(providerId.toString()) },
      buildSummaryPipeline(delta),
    );
    // Verbose per-save log removed (Phase 2) — was firing on every booking
    // write and polluting production logs. The catch block still logs errors.
  } catch (err) {
    console.error(
      `❌ providerSummaryService: delta update failed for ${providerId}:`,
      err.message,
    );
  }
};

// ── Delta extraction from a booking document ──────────────────────────────────

/**
 * Extracts per-provider { buy, sell } totals from a booking document.
 *
 * @param {object} booking - Lean or Mongoose booking document.
 * @returns {Map<string, { buy: number, sell: number }>}
 */
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

// ── Full resync (authoritative recalculation from source data) ────────────────

/**
 * Recomputes a provider's summary from scratch using DB aggregations.
 *
 * Performance fix (Phase 2):
 *   Previously used Booking.find({...}).lean() which materialised every
 *   matching booking document into Node heap memory. For a provider with
 *   2,000 bookings this could be tens of MB of JS objects just to sum
 *   two fields.
 *
 *   Now uses a single $unwind + $group aggregation to compute totalBuy and
 *   totalSell entirely inside MongoDB — zero documents transferred to Node.
 *   The other three aggregations (payments, directPay, collections) were
 *   already using $aggregate correctly and are unchanged.
 *
 * @param {string} providerId
 * @returns {Promise<object>} The fully recomputed summary object.
 */
export const resyncProviderSummary = async (providerId) => {
  const Booking            = mongoose.model("Booking");
  const ProviderPayment    = mongoose.model("ProviderPayment");
  const Payment            = mongoose.model("Payment");
  const ProviderCollection = mongoose.model("ProviderCollection");

  const providerObjId = new mongoose.Types.ObjectId(providerId);

  // ── Booking service totals — aggregated server-side ───────────────────────
  // $unwind + $match + $group keeps zero booking documents in Node heap.
  // Only the final { totalBuy, totalSell } accumulator is returned.
  const [bookingAgg, provPayAgg, directPayAgg, collectionAgg] = await Promise.all([
    Booking.aggregate([
      { $match:  { "services.provider": providerObjId } },
      { $unwind: "$services" },
      { $match:  { "services.provider": providerObjId } },
      {
        $group: {
          _id:       null,
          totalBuy:  { $sum: "$services.buy"  },
          totalSell: { $sum: "$services.sell" },
        },
      },
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

  const totalBuy                  = bookingAgg[0]?.totalBuy  ?? 0;
  const totalSell                 = bookingAgg[0]?.totalSell ?? 0;
  const totalWeHavePaid           = provPayAgg[0]?.total     ?? 0;
  const totalCustomersPaidDirect  = directPayAgg[0]?.total   ?? 0;
  const totalCollectedFromProvider = collectionAgg[0]?.total ?? 0;

  const totalCredits   = totalWeHavePaid + totalCustomersPaidDirect;
  const currentBalance = totalBuy - totalCredits + totalCollectedFromProvider;

  // Use the shared helper instead of duplicating the threshold/label logic
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

  return {
    totalBuy,
    totalSell,
    totalWeHavePaid,
    totalCustomersPaidDirect,
    totalCollectedFromProvider,
    totalCredits,
    currentBalance,
    balanceType,
    balanceLabel,
  };
};
