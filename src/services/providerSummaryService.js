/**
 * providerSummaryService.js
 *
 * Central service that keeps Provider.summary in sync with the four
 * source collections that affect a provider's financial position.
 *
 * TWO public entry points
 * ───────────────────────
 * 1. applyProviderSummaryDelta(providerId, delta)
 *    Increments raw counters and recomputes all derived fields in a single
 *    atomic MongoDB aggregation-pipeline update.  Zero extra round-trips.
 *    Used by Mongoose hooks and the payment controller.
 *
 * 2. resyncProviderSummary(providerId)
 *    Full recalculation from scratch by scanning all four source collections.
 *    Call via the admin /resync/:id endpoint after data imports or if drift
 *    is ever suspected.
 *
 * Circular-import strategy
 * ────────────────────────
 * This file imports only provider.model directly.
 * All other models are accessed lazily via mongoose.model() to avoid
 * circular-dependency chains through booking.model → this file → booking.model.
 */

import mongoose from "mongoose";
import providerModel from "../../DB/model/provider.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal: aggregation-pipeline update — one round-trip, fully atomic
//
// Stage 1: apply increments to the five raw counters (via $add + $ifNull)
// Stage 2: recompute totalCredits and currentBalance from updated counters
// Stage 3: derive balanceType and balanceLabel from currentBalance
// ─────────────────────────────────────────────────────────────────────────────
const buildSummaryPipeline = (delta) => {
  const inc = (field, amount) => ({
    $add: [{ $ifNull: [`$summary.${field}`, 0] }, amount],
  });

  return [
    // Stage 1 — apply raw increments
    {
      $set: {
        "summary.totalBuy": inc("totalBuy", delta.totalBuy ?? 0),
        "summary.totalSell": inc("totalSell", delta.totalSell ?? 0),
        "summary.totalWeHavePaid": inc(
          "totalWeHavePaid",
          delta.totalWeHavePaid ?? 0,
        ),
        "summary.totalCustomersPaidDirect": inc(
          "totalCustomersPaidDirect",
          delta.totalCustomersPaidDirect ?? 0,
        ),
        "summary.totalCollectedFromProvider": inc(
          "totalCollectedFromProvider",
          delta.totalCollectedFromProvider ?? 0,
        ),
        "summary.lastSynced": new Date(),
      },
    },

    // Stage 2 — recompute derived aggregates
    {
      $set: {
        "summary.totalCredits": {
          $add: [
            "$summary.totalWeHavePaid",
            "$summary.totalCustomersPaidDirect",
          ],
        },
        "summary.currentBalance": {
          // balance = totalBuy − (weHavePaid + customerDirect) + collected
          $subtract: [
            {
              $add: [
                "$summary.totalBuy",
                "$summary.totalCollectedFromProvider",
              ],
            },
            {
              $add: [
                "$summary.totalWeHavePaid",
                "$summary.totalCustomersPaidDirect",
              ],
            },
          ],
        },
      },
    },

    // Stage 3 — human-readable balance type and label
    {
      $set: {
        "summary.balanceType": {
          $switch: {
            branches: [
              {
                case: { $gt: ["$summary.currentBalance", 0.01] },
                then: "we_owe_provider",
              },
              {
                case: { $lt: ["$summary.currentBalance", -0.01] },
                then: "provider_owes_us",
              },
            ],
            default: "settled",
          },
        },
        "summary.balanceLabel": {
          $cond: {
            if: { $gt: ["$summary.currentBalance", 0.01] },
            then: {
              $concat: [
                "Agency owes provider: $",
                {
                  $toString: {
                    $round: ["$summary.currentBalance", 2],
                  },
                },
              ],
            },
            else: {
              $cond: {
                if: { $lt: ["$summary.currentBalance", -0.01] },
                then: {
                  $concat: [
                    "Provider owes agency: $",
                    {
                      $toString: {
                        $round: [{ $abs: "$summary.currentBalance" }, 2],
                      },
                    },
                  ],
                },
                else: "Account settled — no outstanding balance",
              },
            },
          },
        },
      },
    },
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: apply an incremental delta to a provider's summary
//
// delta shape (all fields optional, default 0):
//   { totalBuy, totalSell, totalWeHavePaid,
//     totalCustomersPaidDirect, totalCollectedFromProvider }
//
// Pass negative values to reverse a previously applied delta (e.g. on delete).
// ─────────────────────────────────────────────────────────────────────────────
export const applyProviderSummaryDelta = async (providerId, delta) => {
  if (!providerId) return;

  // التأكد من وجود تغييرات فعلية
  const hasChange = Object.values(delta).some((v) => v !== 0);
  if (!hasChange) return;

  try {
    // استخدام Native Driver الخاص بـ MongoDB لتمرير الـ Pipeline مباشرة
    await providerModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(providerId.toString()) },
      buildSummaryPipeline(delta),
    );

    console.log(`✅ Provider ${providerId} summary synchronized.`);
  } catch (err) {
    console.error(
      `❌ providerSummaryService: delta update failed for ${providerId}:`,
      err.message,
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: extract per-provider {buy, sell} from a booking document
// Returns Map<providerId:string, { buy: number, sell: number }>
// ─────────────────────────────────────────────────────────────────────────────
export const computeServiceDeltas = (booking) => {
  const map = new Map();

  const add = (pid, buy, sell) => {
    if (!pid) return;
    const k = pid.toString();
    const cur = map.get(k) || { buy: 0, sell: 0 };
    map.set(k, {
      buy: cur.buy + (Number(buy) || 0),
      sell: cur.sell + (Number(sell) || 0),
    });
  };

  for (const item of booking.accommodations || []) {
    add(item.hotel, item.buy, item.sell);
  }
  for (const item of booking.carRentals || []) {
    add(item.provider, item.buy, item.sell);
  }
  for (const item of booking.carWithDriver || []) {
    add(item.provider, item.buy, item.sell);
  }

  return map;
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: full recalculation from scratch (admin resync endpoint)
//
// Scans all four source collections and overwrites Provider.summary
// with precise values.  Safe to call at any time — idempotent.
// ─────────────────────────────────────────────────────────────────────────────
export const resyncProviderSummary = async (providerId) => {
  // Lazy model references to avoid circular imports
  const Booking = mongoose.model("Booking");
  const ProviderPayment = mongoose.model("ProviderPayment");
  const Payment = mongoose.model("Payment");
  const ProviderCollection = mongoose.model("ProviderCollection");

  const providerObjId = new mongoose.Types.ObjectId(providerId);

  // ── 1. Scan all bookings that reference this provider in any service role ──
  const bookings = await Booking.find({
    $or: [
      { provider: providerObjId },
      { "accommodations.hotel": providerObjId },
      { "carRentals.provider": providerObjId },
      { "carWithDriver.provider": providerObjId },
    ],
  }).lean();

  let totalBuy = 0;
  let totalSell = 0;

  for (const booking of bookings) {
    for (const item of booking.accommodations || []) {
      if (item.hotel?.toString() === providerId) {
        totalBuy += Number(item.buy) || 0;
        totalSell += Number(item.sell) || 0;
      }
    }
    for (const item of booking.carRentals || []) {
      if (item.provider?.toString() === providerId) {
        totalBuy += Number(item.buy) || 0;
        totalSell += Number(item.sell) || 0;
      }
    }
    for (const item of booking.carWithDriver || []) {
      if (item.provider?.toString() === providerId) {
        totalBuy += Number(item.buy) || 0;
        totalSell += Number(item.sell) || 0;
      }
    }
  }

  // ── 2. Aggregate the three payment types ───────────────────────────────────
  const [provPayAgg, directPayAgg, collectionAgg] = await Promise.all([
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

  const totalWeHavePaid = provPayAgg[0]?.total || 0;
  const totalCustomersPaidDirect = directPayAgg[0]?.total || 0;
  const totalCollectedFromProvider = collectionAgg[0]?.total || 0;

  // ── 3. Derive computed fields ───────────────────────────────────────────────
  const totalCredits = totalWeHavePaid + totalCustomersPaidDirect;
  const currentBalance = totalBuy - totalCredits + totalCollectedFromProvider;

  const balanceType =
    currentBalance > 0.01
      ? "we_owe_provider"
      : currentBalance < -0.01
        ? "provider_owes_us"
        : "settled";

  const balanceLabel =
    balanceType === "we_owe_provider"
      ? `Agency owes provider: $${currentBalance.toFixed(2)}`
      : balanceType === "provider_owes_us"
        ? `Provider owes agency: $${Math.abs(currentBalance).toFixed(2)}`
        : "Account settled — no outstanding balance";

  // ── 4. Overwrite with precise values ───────────────────────────────────────
  await providerModel.findByIdAndUpdate(providerId, {
    $set: {
      "summary.totalBuy": totalBuy,
      "summary.totalSell": totalSell,
      "summary.totalWeHavePaid": totalWeHavePaid,
      "summary.totalCustomersPaidDirect": totalCustomersPaidDirect,
      "summary.totalCollectedFromProvider": totalCollectedFromProvider,
      "summary.totalCredits": totalCredits,
      "summary.currentBalance": currentBalance,
      "summary.balanceType": balanceType,
      "summary.balanceLabel": balanceLabel,
      "summary.lastSynced": new Date(),
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
