import mongoose from "mongoose";
import providerModel from "../../DB/model/provider.model.js";

const buildSummaryPipeline = (delta) => {
  const inc = (field, amount) => ({
    $add: [{ $ifNull: [`$summary.${field}`, 0] }, amount],
  });

  return [
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
    {
      $set: {
        "summary.totalCredits": {
          $add: [
            "$summary.totalWeHavePaid",
            "$summary.totalCustomersPaidDirect",
          ],
        },
        "summary.currentBalance": {
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
                { $toString: { $round: ["$summary.currentBalance", 2] } },
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

export const applyProviderSummaryDelta = async (providerId, delta) => {
  if (!providerId) return;

  const hasChange = Object.values(delta).some((v) => v !== 0);
  if (!hasChange) return;

  try {
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

/**
 * Extracts per-provider { buy, sell } totals from a booking document.
 * Works with the unified services array — provider-agnostic by design.
 *
 * @param {object} booking - Lean booking document
 * @returns {Map<string, { buy: number, sell: number }>}
 */
export const computeServiceDeltas = (booking) => {
  const map = new Map();

  for (const service of booking.services || []) {
    if (!service.provider) continue;
    const k = service.provider.toString();
    const cur = map.get(k) || { buy: 0, sell: 0 };
    map.set(k, {
      buy: cur.buy + (Number(service.buy) || 0),
      sell: cur.sell + (Number(service.sell) || 0),
    });
  }

  return map;
};

export const resyncProviderSummary = async (providerId) => {
  const Booking = mongoose.model("Booking");
  const ProviderPayment = mongoose.model("ProviderPayment");
  const Payment = mongoose.model("Payment");
  const ProviderCollection = mongoose.model("ProviderCollection");

  const providerObjId = new mongoose.Types.ObjectId(providerId);

  // Scan all bookings where this provider appears as main or as a service provider
  const bookings = await Booking.find({
    $or: [{ provider: providerObjId }, { "services.provider": providerObjId }],
  }).lean();

  let totalBuy = 0;
  let totalSell = 0;

  for (const booking of bookings) {
    for (const service of booking.services || []) {
      if (service.provider?.toString() === providerId) {
        totalBuy += Number(service.buy) || 0;
        totalSell += Number(service.sell) || 0;
      }
    }
  }

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
