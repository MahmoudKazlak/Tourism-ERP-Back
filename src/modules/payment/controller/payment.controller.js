import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";

// ─────────────────────────────────────────────
// دالة مساعدة: تحسب مجموع الدفعات وتحدث الحجز
// تستخدم session للـ transactions
// ─────────────────────────────────────────────
const syncBookingPayments = async (bookingId, session = null) => {
  const opts = session ? { session } : {};

  const result = await paymentModel.aggregate(
    [
      { $match: { booking: new mongoose.Types.ObjectId(bookingId) } },
      { $group: { _id: null, totalPaid: { $sum: "$amount" } } },
    ],
    session ? { session } : {},
  );

  const totalPaid = result[0]?.totalPaid || 0;
  const booking = await bookingModel
    .findById(bookingId)
    .session(session || null);
  if (!booking) return null;

  let paymentStatus = "unpaid";
  if (totalPaid >= booking.totalToPay && totalPaid > 0) paymentStatus = "paid";
  else if (totalPaid > 0) paymentStatus = "partial";

  await bookingModel.updateOne(
    { _id: bookingId },
    {
      $set: {
        totalPaid,
        remainingBalance: booking.totalToPay - totalPaid,
        paymentStatus,
      },
    },
    opts,
  );

  return {
    totalToPay: booking.totalToPay,
    totalPaid,
    remainingBalance: booking.totalToPay - totalPaid,
    paymentStatus,
  };
};

// ─────────────────────────────────────────────
// إضافة دفعة — مع Mongoose Transaction
// ─────────────────────────────────────────────
export const addPayment = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, date, method, notes } = req.body;

  // التحقق من وجود الحجز أولاً قبل فتح الـ session
  const booking = await bookingModel
    .findById(id)
    .select("bookingID customers totalToPay totalPaid paymentStatus");
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus === "paid") {
    return next(new Error("Booking is already fully paid", { cause: 400 }));
  }

  const numAmount = Number(amount);
  if (numAmount > booking.totalToPay - booking.totalPaid + 0.001) {
    // نحكيهم بس ما نمنعهم — ممكن يكون دفع زيادة عن قصد
    // يمكن تغيير هاي السياسة حسب ما تريد
  }

  // ─── بداية الـ Transaction ───
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
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

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Payment added successfully",
      data: {
        payment: payment[0],
        bookingSummary: updated,
      },
      errors: null,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new Error(error.message, { cause: 500 }));
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────
// دفعات حجز معين
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// كل الدفعات مع فلترة (للحسابات)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// حذف دفعة — مع Transaction
// ─────────────────────────────────────────────
export const deletePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel.findById(paymentId);
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
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

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Payment deleted successfully",
      data: { bookingSummary: updated },
      errors: null,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new Error(error.message, { cause: 500 }));
  } finally {
    session.endSession();
  }
});
