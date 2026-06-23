import paymentModel            from "../../../../DB/model/payment.model.js";
import providerPaymentModel    from "../../../../DB/model/providerPayment.model.js";
import providerCollectionModel from "../../../../DB/model/providerCollection.model.js";

const BATCH = 500;

export const streamPayments = () =>
  paymentModel.find({}).sort({ date: 1 })
    .populate("booking",           "bookingID customers")
    .populate("recordedBy",        "userName")
    .populate("providerRecipient", "name")
    .select("-__v").lean().cursor({ batchSize: BATCH });

export const getPaymentSummary = () =>
  paymentModel.aggregate([{ $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]);

export const streamProviderPayments = () =>
  providerPaymentModel.find({}).sort({ date: 1 })
    .populate("provider",   "name type")
    .populate("recordedBy", "userName")
    .select("-__v").lean().cursor({ batchSize: BATCH });

export const getProviderPaymentSummary = () =>
  providerPaymentModel.aggregate([{ $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]);

export const streamProviderCollections = () =>
  providerCollectionModel.find({}).sort({ date: 1 })
    .populate("provider",   "name type")
    .populate("booking",    "bookingID")
    .populate("recordedBy", "userName")
    .select("-__v").lean().cursor({ batchSize: BATCH });
