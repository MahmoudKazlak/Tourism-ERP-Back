import { asyncHandler } from "../../../middleware/asyncHandler.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";
import { notifyProviderPaymentRecorded } from "../../../services/notification.js";
import { applyProviderSummaryDelta } from "../../../services/providerSummaryService.js";

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

  const [payments, totalCount, filteredTotalResult, allTimeTotalResult] =
    await Promise.all([
      providerPaymentModel
        .find(query)
        .populate("recordedBy", "userName")
        .sort({ date: -1 })
        .limit(limit)
        .skip(skip),
      providerPaymentModel.countDocuments(query),
      providerPaymentModel.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
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
      totalPaidToProvider: filteredTotalResult[0]?.total || 0,
      allTimeTotalPaidToProvider: allTimeTotalResult[0]?.total || 0,
      isFiltered: Boolean(fromDate || toDate),
      payments,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Edit a provider payment (Admin only)
// PATCH /api/v1/provider-payment/:paymentId
//
// Editable fields: amount, date, method, notes, reference.
// When amount changes the provider summary delta is corrected post-save.
// ─────────────────────────────────────────────────────────────────────────────
export const editProviderPayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;
  const { amount, date, method, notes, reference } = req.body;

  const payment = await providerPaymentModel
    .findById(paymentId)
    .populate("provider", "name");
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const oldAmount = payment.amount;
  const newAmount = amount !== undefined ? Number(amount) : oldAmount;
  const amountChanged = newAmount !== oldAmount;

  // Apply field updates
  if (amount !== undefined) payment.amount = newAmount;
  if (date !== undefined) payment.date = date;
  if (method !== undefined) payment.method = method;
  if (notes !== undefined) payment.notes = notes;
  if (reference !== undefined) payment.reference = reference;

  // Temporarily bypass the post-save hook that would double-apply the delta.
  // We apply only the DIFF manually after saving.
  payment._skipSummaryHook = true;
  await payment.save();

  // Apply the net delta to provider summary (only the change, not the full amount)
  if (amountChanged) {
    await applyProviderSummaryDelta(payment.provider._id, {
      totalWeHavePaid: newAmount - oldAmount,
    });
  }

  await logModel.create({
    user: req.user._id,
    action: "EDIT_PROVIDER_PAYMENT",
    details: {
      paymentId,
      providerId: payment.provider._id,
      providerName: payment.provider.name,
      changes: {
        ...(amountChanged && { amount: { from: oldAmount, to: newAmount } }),
        ...(method !== undefined && { method }),
        ...(date !== undefined && { date }),
        ...(notes !== undefined && { notes }),
        ...(reference !== undefined && { reference }),
      },
    },
  });

  return res.status(200).json({
    success: true,
    message: "Provider payment updated successfully",
    data: { payment },
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
// Get all provider payments — accounting overview
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

// ─────────────────────────────────────────────────────────────────────────────
// Get a single provider payment by ID
// GET /api/v1/provider-payment/payment/:paymentId
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderPaymentById = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await providerPaymentModel
    .findById(paymentId)
    .populate("provider", "name type phone")
    .populate("recordedBy", "userName");

  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { payment },
    errors: null,
  });
});

// NEW — add after getProviderPaymentById
/**
 * Streams a PDFKit-based receipt for a provider payment.
 * GET /api/v1/provider-payment/payment/:paymentId/receipt
 */
export const downloadProviderPaymentReceipt = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await providerPaymentModel
    .findById(paymentId)
    .populate("provider", "name")
    .populate("booking", "bookingID referenceCode")
    .populate("recordedBy", "userName")
    .lean();

  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const officeSettingsModel = (await import("../../../../DB/model/officeSettings.model.js")).default;
  const officeSettings = await officeSettingsModel.findOne().lean();

  const receipt = {
    receiptType:   "providerPayment",
    receiptNumber: `REC-${payment._id.toString().slice(-8).toUpperCase()}`,
    issueDate:     new Date(),
    amount:        payment.amount,
    method:        payment.method,
    date:          payment.date,
    reference:     payment.reference || null,
    notes:         payment.notes     || null,
    booking:       payment.booking
      ? { bookingID: payment.booking.bookingID, referenceCode: payment.booking.referenceCode }
      : null,
    entity: { label: "Provider", name: payment.provider?.name || "—" },
    recordedBy: payment.recordedBy?.userName || "—",
  };

  const { generateReceiptPdfBuffer } = await import("../../../services/receiptPdfService.js");
  const buffer = await generateReceiptPdfBuffer(receipt, officeSettings);

  const filename = `receipt-provider-payment-${payment._id.toString().slice(-8)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  return res.end(buffer);
});