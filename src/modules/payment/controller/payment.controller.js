import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";
import { withTransaction } from "../../../services/transaction.js";
import { notifyPaymentRecorded } from "../../../services/notification.js";
import { applyProviderSummaryDelta } from "../../../services/providerSummaryService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: recalculate totalPaid from all payments and sync the booking.
// ─────────────────────────────────────────────────────────────────────────────
const syncBookingPayments = async (bookingId, session = null) => {
  const aggregateOptions = session ? { session } : {};

  const result = await paymentModel.aggregate(
    [
      { $match: { booking: new mongoose.Types.ObjectId(bookingId) } },
      { $group: { _id: null, totalPaid: { $sum: "$amount" } } },
    ],
    aggregateOptions,
  );

  const totalPaid = result[0]?.totalPaid || 0;
  const booking = await bookingModel
    .findById(bookingId)
    .session(session || null);
  if (!booking) return null;

  let paymentStatus = "unpaid";
  if (totalPaid >= booking.totalToPay && totalPaid > 0) {
    paymentStatus = "paid";
  } else if (totalPaid > 0) {
    paymentStatus = "partial";
  }

  await bookingModel.updateOne(
    { _id: bookingId },
    {
      $set: {
        totalPaid,
        remainingBalance: booking.totalToPay - totalPaid,
        paymentStatus,
      },
    },
    session ? { session } : {},
  );

  return {
    totalToPay: booking.totalToPay,
    totalPaid,
    remainingBalance: booking.totalToPay - totalPaid,
    paymentStatus,
  };
};

/**
 * Returns the set of provider IDs directly referenced by a booking.
 * Used to validate that a direct payment recipient is linked to the booking.
 */
const getLinkedProviderIds = (booking) => {
  return new Set([
    booking.provider.toString(),
    ...(booking.accommodations || [])
      .map((a) => a.hotel?.toString())
      .filter(Boolean),
    ...(booking.carRentals || [])
      .map((c) => c.provider?.toString())
      .filter(Boolean),
    ...(booking.carWithDriver || [])
      .map((t) => t.provider?.toString())
      .filter(Boolean),
  ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Add payment
//
// Provider summary update strategy for direct payments (providerRecipient set):
//   We intentionally do NOT use a Mongoose hook on the Payment model because
//   the payment is created inside a transaction. Hooks would fire before the
//   transaction commits, risking summary drift if the transaction aborts.
//   Instead, we apply the delta AFTER withTransaction() resolves (post-commit).
// ─────────────────────────────────────────────────────────────────────────────
export const addPayment = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, date, method, notes, providerRecipient } = req.body;

  const booking = await bookingModel
    .findById(id)
    .populate("createdBy", "userName email");

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus === "paid") {
    return next(new Error("Booking is already fully paid", { cause: 400 }));
  }

  // ── Validate direct-payment recipient ─────────────────────────────────────
  if (providerRecipient) {
    const providerExists = await providerModel
      .findById(providerRecipient)
      .select("_id name");
    if (!providerExists) {
      return next(new Error("Provider not found", { cause: 404 }));
    }

    const linkedIds = getLinkedProviderIds(booking);
    if (!linkedIds.has(providerRecipient.toString())) {
      return next(
        new Error(
          "The specified provider is not linked to this booking. " +
            "Direct payments can only be recorded for providers referenced in the booking's services.",
          { cause: 400 },
        ),
      );
    }
  }

  const numAmount = Number(amount);

  // ── Execute within transaction ────────────────────────────────────────────
  const result = await withTransaction(async (session) => {
    const payment = await paymentModel.create(
      [
        {
          booking: id,
          bookingID: booking.bookingID,
          amount: numAmount,
          date: date || new Date(),
          method: method || "cash",
          notes,
          providerRecipient: providerRecipient || null,
          recordedBy: req.user._id,
        },
      ],
      { session },
    );

    const updated = await syncBookingPayments(booking._id, session);

    await logModel.create(
      [
        {
          user: req.user._id,
          action: providerRecipient
            ? "ADD_DIRECT_PROVIDER_PAYMENT"
            : "ADD_PAYMENT",
          details: {
            bookingID: booking.bookingID,
            paymentId: payment[0]._id,
            amount: numAmount,
            method,
            providerRecipient: providerRecipient || null,
            newTotalPaid: updated.totalPaid,
            newRemainingBalance: updated.remainingBalance,
            newPaymentStatus: updated.paymentStatus,
          },
        },
      ],
      { session },
    );

    return { payment: payment[0], bookingSummary: updated };
  });

  // ── Post-commit: update provider summary (outside transaction) ────────────
  // Safe here — transaction has committed; if this fails, resync can fix it.
  if (providerRecipient) {
    await applyProviderSummaryDelta(providerRecipient, {
      totalCustomersPaidDirect: numAmount,
    });
  }

  await notifyPaymentRecorded(
    booking,
    result.payment,
    req.user.userName,
    result.bookingSummary,
  );

  return res.status(201).json({
    success: true,
    message: providerRecipient
      ? "Direct provider payment recorded successfully"
      : "Payment added successfully",
    data: result,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get payments for a specific booking
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentsByBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const booking = await bookingModel
    .findById(id)
    .select(
      "bookingID customers totalToPay totalPaid remainingBalance paymentStatus",
    );

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const payments = await paymentModel
    .find({ booking: id })
    .populate("recordedBy", "userName")
    .populate("providerRecipient", "name type")
    .sort({ date: -1 });

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      bookingID: booking.bookingID,
      customer: booking.customers[0]?.name || "Unknown",
      totalToPay: booking.totalToPay,
      totalPaid: booking.totalPaid,
      remainingBalance: booking.remainingBalance,
      paymentStatus: booking.paymentStatus,
      paymentsCount: payments.length,
      payments,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all payments (accounting overview)
// ─────────────────────────────────────────────────────────────────────────────
export const getAllPayments = asyncHandler(async (req, res) => {
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
    paymentModel
      .find(query)
      .populate("booking", "bookingID customers status")
      .populate("recordedBy", "userName")
      .populate("providerRecipient", "name type")
      .sort({ date: -1 })
      .limit(limit)
      .skip(skip),
    paymentModel.countDocuments(query),
    paymentModel.aggregate([
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
// Delete payment
//
// Same post-commit strategy as addPayment: apply the reversal delta AFTER
// the transaction resolves to avoid hook/transaction ordering issues.
// ─────────────────────────────────────────────────────────────────────────────
export const deletePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  // Fetch before transaction so we have providerRecipient and amount available
  // for the post-commit summary update.
  const payment = await paymentModel.findById(paymentId);
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  // Capture before entering transaction (needed post-commit)
  const recipientId = payment.providerRecipient;
  const deletedAmount = payment.amount;

  const result = await withTransaction(async (session) => {
    const bookingId = payment.booking;

    // Use model-level deleteOne with session (safe with Mongoose 7+)
    await paymentModel.deleteOne({ _id: paymentId }, { session });

    const updated = await syncBookingPayments(bookingId, session);

    await logModel.create(
      [
        {
          user: req.user._id,
          action: recipientId
            ? "DELETE_DIRECT_PROVIDER_PAYMENT"
            : "DELETE_PAYMENT",
          details: {
            paymentId,
            bookingID: payment.bookingID,
            deletedAmount,
            providerRecipient: recipientId || null,
            newTotalPaid: updated.totalPaid,
            newPaymentStatus: updated.paymentStatus,
          },
        },
      ],
      { session },
    );

    return { bookingSummary: updated };
  });

  // ── Post-commit: reverse the provider summary increment ───────────────────
  if (recipientId) {
    await applyProviderSummaryDelta(recipientId, {
      totalCustomersPaidDirect: -deletedAmount,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Payment deleted successfully",
    data: result,
    errors: null,
  });
});
