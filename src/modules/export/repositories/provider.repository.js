import providerModel from "../../../../DB/model/provider.model.js";

const BATCH = 500;

export const streamProviders = () =>
  providerModel.find({}).sort({ name: 1 })
    .select("-__v -updatedAt").lean().cursor({ batchSize: BATCH });

export const getProviderSummary = () =>
  providerModel.aggregate([{ $group: {
    _id:            null,
    totalProviders: { $sum: 1 },
    totalBuy:       { $sum: "$summary.totalBuy"       },
    totalSell:      { $sum: "$summary.totalSell"      },
    totalWeOwed:    { $sum: "$summary.currentBalance" },
  }}]);
