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
 * Scans the unified services array plus the main booking provider.
 *
 * FIX Bug 6: removed the duplicate JSDoc comment that existed above this
 * function in the old version.
 */
const getLinkedProviderIds = (booking) => {
  return new Set([
    booking.provider.toString(),
    ...(booking.services || [])
      .map((s) => s.provider?.toString())
      .filter(Boolean),
  ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Add payment
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

  // Post-commit: update provider summary (outside transaction)
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
// ─────────────────────────────────────────────────────────────────────────────
export const deletePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel.findById(paymentId);
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const recipientId = payment.providerRecipient;
  const deletedAmount = payment.amount;

  const result = await withTransaction(async (session) => {
    const bookingId = payment.booking;

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

  // Post-commit: reverse the provider summary increment
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

// ─────────────────────────────────────────────────────────────────────────────
// Edit payment (Admin only)
//
// FIX Bug 3: bookingSummary is no longer null when only metadata fields
// (method, notes, date) change — the current booking state is always
// returned in the response.
//
// FIX Bug 11: overpayment guard added — editing an amount beyond the
// booking's totalToPay is rejected before the transaction starts.
//
// Provider summary delta strategy (same as add/delete):
//   Applied POST-COMMIT outside the transaction so a failed summary update
//   never rolls back an otherwise valid payment edit.
// ─────────────────────────────────────────────────────────────────────────────
export const editPayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;
  const { amount, date, method, notes, providerRecipient } = req.body;

  const payment = await paymentModel.findById(paymentId);
  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const oldAmount = payment.amount;
  const oldRecipient = payment.providerRecipient?.toString() ?? null;

  // Resolve the final recipient value
  const newRecipient =
    providerRecipient !== undefined
      ? providerRecipient === null
        ? null
        : providerRecipient.toString()
      : oldRecipient;

  const newAmount = amount !== undefined ? Number(amount) : oldAmount;
  const amountChanged = newAmount !== oldAmount;
  const recipientChanged = newRecipient !== oldRecipient;

  // ── Validate new providerRecipient if being set ───────────────────────────
  if (providerRecipient && providerRecipient !== null) {
    const providerDoc = await providerModel
      .findById(providerRecipient)
      .select("_id");
    if (!providerDoc) {
      return next(new Error("Provider not found", { cause: 404 }));
    }

    const bookingDoc = await bookingModel.findById(payment.booking).lean();
    if (bookingDoc) {
      const linkedIds = getLinkedProviderIds(bookingDoc);
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
  }

  // ── Bug 11: overpayment guard ─────────────────────────────────────────────
  if (amountChanged) {
    const otherPaymentsAgg = await paymentModel.aggregate([
      {
        $match: {
          booking: new mongoose.Types.ObjectId(payment.booking),
          _id: { $ne: new mongoose.Types.ObjectId(payment._id) },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const othersTotal = otherPaymentsAgg[0]?.total || 0;

    const bookingForCheck = await bookingModel
      .findById(payment.booking)
      .select("totalToPay")
      .lean();

    if (
      bookingForCheck &&
      newAmount + othersTotal > bookingForCheck.totalToPay
    ) {
      const maxAllowed = bookingForCheck.totalToPay - othersTotal;
      return next(
        new Error(
          `Payment amount $${newAmount} would exceed the booking total $${bookingForCheck.totalToPay}. ` +
            `Maximum allowed for this payment: $${maxAllowed.toFixed(2)}`,
          { cause: 400 },
        ),
      );
    }
  }

  // ── Transaction ───────────────────────────────────────────────────────────
  const result = await withTransaction(async (session) => {
    if (amount !== undefined) payment.amount = newAmount;
    if (date !== undefined) payment.date = date;
    if (method !== undefined) payment.method = method;
    if (notes !== undefined) payment.notes = notes;
    if (providerRecipient !== undefined)
      payment.providerRecipient = providerRecipient ?? null;

    await payment.save({ session });

    // Bug 3 fix: always return current booking state, re-sync only when needed
    let bookingSummary;
    if (amountChanged) {
      bookingSummary = await syncBookingPayments(payment.booking, session);
    } else {
      // Fetch without re-syncing — totals haven't changed
      const bk = await bookingModel
        .findById(payment.booking)
        .select("totalToPay totalPaid remainingBalance paymentStatus")
        .session(session);
      bookingSummary = bk
        ? {
            totalToPay: bk.totalToPay,
            totalPaid: bk.totalPaid,
            remainingBalance: bk.remainingBalance,
            paymentStatus: bk.paymentStatus,
          }
        : null;
    }

    await logModel.create(
      [
        {
          user: req.user._id,
          action: "EDIT_PAYMENT",
          details: {
            paymentId,
            bookingID: payment.bookingID,
            changes: {
              ...(amountChanged && {
                amount: { from: oldAmount, to: newAmount },
              }),
              ...(recipientChanged && {
                providerRecipient: { from: oldRecipient, to: newRecipient },
              }),
              ...(method !== undefined && { method }),
              ...(date !== undefined && { date }),
              ...(notes !== undefined && { notes }),
            },
          },
        },
      ],
      { session },
    );

    return { payment, bookingSummary };
  });

  // ── Post-commit: reconcile provider summary deltas ────────────────────────
  //
  // Four cases:
  //   old=null, new=null          → nothing to do
  //   old=X,    new=null          → reverse old amount on X
  //   old=null, new=Y             → apply new amount on Y
  //   old=X,    new=Y (X ≠ Y)    → reverse old on X, apply new on Y
  //   old=X,    new=X, amt change → push only the diff on X

  if (recipientChanged) {
    if (oldRecipient) {
      await applyProviderSummaryDelta(oldRecipient, {
        totalCustomersPaidDirect: -oldAmount,
      });
    }
    if (newRecipient) {
      await applyProviderSummaryDelta(newRecipient, {
        totalCustomersPaidDirect: newAmount,
      });
    }
  } else if (amountChanged && newRecipient) {
    // Same recipient, different amount → push only the diff
    await applyProviderSummaryDelta(newRecipient, {
      totalCustomersPaidDirect: newAmount - oldAmount,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Payment updated successfully",
    data: result,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get a single payment by ID
// GET /api/v1/booking/payments/:paymentId
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentById = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel
    .findById(paymentId)
    .populate("booking", "bookingID customers")
    .populate("recordedBy", "userName")
    .populate("providerRecipient", "name type");

  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { payment },
    errors: null,
  });
});