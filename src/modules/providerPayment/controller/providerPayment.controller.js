import { asyncHandler } from "../../../middleware/asyncHandler.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";
import { notifyProviderPaymentRecorded } from "../../../services/notification.js";

// ─────────────────────────────────────────────────────────────────────────────
// Record a payment made TO a provider
// POST /api/v1/provider-payment/:providerId
// ─────────────────────────────────────────────────────────────────────────────
export const createProviderPayment = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { amount, date, method, notes, reference } = req.body;

  const provider = await providerModel.findById(providerId);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  const payment = await providerPaymentModel.create({
    provider: providerId,
    amount,
    date: date || new Date(),
    method: method || "cash",
    notes,
    reference,
    recordedBy: req.user._id,
  });

  await logModel.create({
    user: req.user._id,
    action: "CREATE_PROVIDER_PAYMENT",
    details: {
      paymentId: payment._id,
      providerId,
      providerName: provider.name,
      amount,
      method,
    },
  });

  // Feature [6]: Email notification — best-effort.
  await notifyProviderPaymentRecorded(
    provider,
    payment,
    req.user.email,
    req.user.userName,
  );

  return res.status(201).json({
    success: true,
    message: "Provider payment recorded successfully",
    data: { payment },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all payments for a provider (paginated)
// GET /api/v1/provider-payment/:providerId
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderPayments = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { fromDate, toDate, page, size } = req.query;

  const provider = await providerModel.findById(providerId).lean();
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  const query = { provider: providerId };
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.date.$lte = to;
    }
  }

  const { limit, skip } = pagination(page, size);

  const [payments, totalCount, totalAmountResult] = await Promise.all([
    providerPaymentModel
      .find(query)
      .populate("recordedBy", "userName")
      .sort({ date: -1 })
      .limit(limit)
      .skip(skip),
    providerPaymentModel.countDocuments(query),
    providerPaymentModel.aggregate([
      { $match: { provider: provider._id } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      provider: { id: provider._id, name: provider.name, type: provider.type },
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      totalPaidToProvider: totalAmountResult[0]?.total || 0,
      payments,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete a provider payment (Admin only)
// DELETE /api/v1/provider-payment/:paymentId
// ─────────────────────────────────────────────────────────────────────────────
export const deleteProviderPayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await providerPaymentModel
    .findById(paymentId)
    .populate("provider", "name");
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  await payment.deleteOne();

  await logModel.create({
    user: req.user._id,
    action: "DELETE_PROVIDER_PAYMENT",
    details: {
      paymentId,
      providerId: payment.provider._id,
      providerName: payment.provider?.name,
      amount: payment.amount,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Provider payment deleted successfully",
    data: null,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all provider payments — for accounting overview
// GET /api/v1/provider-payment/all
// ─────────────────────────────────────────────────────────────────────────────
export const getAllProviderPayments = asyncHandler(async (req, res) => {
  const { method, fromDate, toDate, page, size } = req.query;

  const query = {};
  if (method) query.method = method;
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.date.$lte = to;
    }
  }

  const { limit, skip } = pagination(page, size);

  const [payments, totalCount, totalAmountResult] = await Promise.all([
    providerPaymentModel
      .find(query)
      .populate("provider", "name type")
      .populate("recordedBy", "userName")
      .sort({ date: -1 })
      .limit(limit)
      .skip(skip),
    providerPaymentModel.countDocuments(query),
    providerPaymentModel.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      totalAmount: totalAmountResult[0]?.total || 0,
      payments,
    },
    errors: null,
  });
});
