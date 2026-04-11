import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";
import { withTransaction } from "../../../services/transaction.js";
import { notifyPaymentRecorded } from "../../../services/notification.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Add payment
// ─────────────────────────────────────────────────────────────────────────────
export const addPayment = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, date, method, notes } = req.body;

  // Populate createdBy to get the email for notification.
  const booking = await bookingModel
    .findById(id)
    .populate("createdBy", "userName email")
    .select("bookingID customers totalToPay totalPaid paymentStatus createdBy");

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus === "paid") {
    return next(new Error("Booking is already fully paid", { cause: 400 }));
  }

  const numAmount = Number(amount);

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
          action: "ADD_PAYMENT",
          details: {
            bookingID: booking.bookingID,
            paymentId: payment[0]._id,
            amount: numAmount,
            method,
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

  // Feature [6]: Send email notification — best-effort, outside transaction.
  await notifyPaymentRecorded(
    booking,
    result.payment,
    req.user.userName,
    result.bookingSummary,
  );

  return res.status(201).json({
    success: true,
    message: "Payment added successfully",
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
// Get all payments (with filtering — for accounting)
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
// ─────────────────────────────────────────────────────────────────────────────
export const deletePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel.findById(paymentId);
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const result = await withTransaction(async (session) => {
    const bookingId = payment.booking;
    const deletedAmount = payment.amount;

    await paymentModel.findByIdAndDelete(paymentId, { session });
    const updated = await syncBookingPayments(bookingId, session);

    await logModel.create(
      [
        {
          user: req.user._id,
          action: "DELETE_PAYMENT",
          details: {
            paymentId,
            bookingID: payment.bookingID,
            deletedAmount,
            newTotalPaid: updated.totalPaid,
            newPaymentStatus: updated.paymentStatus,
          },
        },
      ],
      { session },
    );

    return { bookingSummary: updated };
  });

  return res.status(200).json({
    success: true,
    message: "Payment deleted successfully",
    data: result,
    errors: null,
  });
});
