import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import { pagination } from "../../../services/pagination.js";

// ─────────────────────────────────────────────────────────────────────────────
// Provider Current-Account Statement
//
// Ledger formula:
//   Balance = Σ(buy prices of all services)         ← our total obligation
//           − Σ(ProviderPayment.amount)              ← we paid them directly
//           − Σ(Payment.amount where providerRecipient = X)
//                                                   ← customer paid them on our behalf
//
// A positive balance means we still owe them.
// A negative balance means they are holding our profit as a receivable.
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderStatement = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { fromDate, toDate } = req.query;

  const provider = await providerModel.findById(providerId);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  // Build date filter (shared shape, applied to different fields per collection)
  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    dateFilter.$lte = to;
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // Booking query: any booking that references this provider in any role
  const bookingQuery = {
    $or: [
      { provider: providerId },
      { "accommodations.hotel": providerId },
      { "carRentals.provider": providerId },
      { "carWithDriver.provider": providerId }, // renamed
    ],
  };
  if (hasDateFilter) bookingQuery.createdAt = dateFilter;

  // ProviderPayment query: money we paid out to this provider
  const providerPaymentQuery = { provider: providerId };
  if (hasDateFilter) providerPaymentQuery.date = dateFilter;

  // Direct customer payment query: customer paid this provider on our behalf
  const directPaymentQuery = {
    providerRecipient: new mongoose.Types.ObjectId(providerId),
  };
  if (hasDateFilter) directPaymentQuery.date = dateFilter;

  const [
    bookings,
    providerPaymentsAgg,
    providerPaymentsList,
    directPaymentsAgg,
    directPaymentsList,
  ] = await Promise.all([
    bookingModel.find(bookingQuery).lean(),

    // Aggregate: total we have paid to provider
    providerPaymentModel.aggregate([
      { $match: providerPaymentQuery },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),

    // List of our payments to provider (for the transaction ledger)
    providerPaymentModel
      .find(providerPaymentQuery)
      .populate("recordedBy", "userName")
      .sort({ date: 1 })
      .lean(),

    // Aggregate: total customer paid directly to this provider
    paymentModel.aggregate([
      { $match: directPaymentQuery },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),

    // List of direct customer payments (for the transaction ledger)
    paymentModel
      .find(directPaymentQuery)
      .populate("booking", "bookingID customers")
      .populate("recordedBy", "userName")
      .sort({ date: 1 })
      .lean(),
  ]);

  // ── Build service debit lines (what we owe for each service) ───────────────
  const serviceLines = [];

  const addLines = (items, serviceType, providerKey, labelFn) => {
    items?.forEach((item) => {
      const pid =
        item[providerKey]?._id?.toString() || item[providerKey]?.toString();
      if (pid !== providerId) return;

      const buy = Number(item.buy) || 0;
      serviceLines.push({
        type: "SERVICE_DEBIT",
        serviceType,
        debit: buy,
        credit: 0,
      });
    });
  };

  bookings.forEach((booking) => {
    const meta = {
      bookingID: booking.bookingID,
      bookingMongoId: booking._id,
      customer: booking.customers?.[0]?.name || "Unknown",
      date: booking.createdAt,
    };

    (booking.accommodations || []).forEach((item) => {
      const pid = item.hotel?._id?.toString() || item.hotel?.toString();
      if (pid !== providerId) return;
      serviceLines.push({
        ...meta,
        type: "SERVICE_DEBIT",
        serviceType: "Hotel Accommodation",
        description: `${item.roomType || ""} / ${item.board || ""} / ${item.duration || 0} Nights`,
        debit: Number(item.buy) || 0,
        credit: 0,
      });
    });

    (booking.carRentals || []).forEach((item) => {
      const pid = item.provider?._id?.toString() || item.provider?.toString();
      if (pid !== providerId) return;
      serviceLines.push({
        ...meta,
        type: "SERVICE_DEBIT",
        serviceType: "Car Rental",
        description: `${item.brand || ""} — ${
          item.pickUp ? new Date(item.pickUp).toLocaleDateString() : "N/A"
        }`,
        debit: Number(item.buy) || 0,
        credit: 0,
      });
    });

    // renamed: carWithDriver
    (booking.carWithDriver || []).forEach((item) => {
      const pid = item.provider?._id?.toString() || item.provider?.toString();
      if (pid !== providerId) return;
      serviceLines.push({
        ...meta,
        type: "SERVICE_DEBIT",
        serviceType: "Car with Driver",
        description: `${item.brand || ""} — Driver: ${item.driverName || ""}`,
        debit: Number(item.buy) || 0,
        credit: 0,
      });
    });
  });

  // ── Build credit lines (reductions to our liability) ──────────────────────

  // Credits: payments we made directly to the provider
  const ourPaymentLines = providerPaymentsList.map((p) => ({
    date: p.date,
    type: "OUR_PAYMENT",
    description: `Payment by ${p.recordedBy?.userName || "office"}${p.reference ? ` — Ref: ${p.reference}` : ""}`,
    debit: 0,
    credit: Number(p.amount),
    method: p.method,
    reference: p.reference || null,
  }));

  // Credits: customer paid provider directly on our behalf
  const directPaymentLines = directPaymentsList.map((p) => {
    const bookingID = p.booking?.bookingID;
    const customer = p.booking?.customers?.[0]?.name || "Unknown";
    return {
      date: p.date,
      type: "CUSTOMER_DIRECT_PAYMENT",
      description: `Customer "${customer}" paid provider directly (Booking #${bookingID})`,
      debit: 0,
      credit: Number(p.amount),
      method: p.method,
      bookingID,
    };
  });

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalCostFromProvider = serviceLines.reduce((s, l) => s + l.debit, 0);
  const totalWeHavePaid = providerPaymentsAgg[0]?.total || 0;
  const totalCustomersPaidDirect = directPaymentsAgg[0]?.total || 0;
  const totalCredits = totalWeHavePaid + totalCustomersPaidDirect;
  const outstandingBalance = totalCostFromProvider - totalCredits;

  // ── Unified chronological ledger ───────────────────────────────────────────
  const ledger = [
    ...serviceLines,
    ...ourPaymentLines,
    ...directPaymentLines,
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return res.status(200).json({
    success: true,
    message: "Provider statement generated successfully",
    data: {
      provider: {
        id: provider._id,
        name: provider.name,
        type: provider.type,
        phone: provider.phone,
      },
      period: {
        from: fromDate || "All time",
        to: toDate || "All time",
      },
      summary: {
        // Debits
        totalCostFromProvider,

        // Credits
        totalWeHavePaid,
        totalCustomersPaidDirect,
        totalCredits,

        // Net
        outstandingBalance,
        balanceLabel:
          outstandingBalance > 0
            ? `We owe provider: ${outstandingBalance}`
            : outstandingBalance < 0
              ? `Provider holds our profit: ${Math.abs(outstandingBalance)}`
              : "Account settled",
      },
      // Full double-entry ledger for display / export
      ledger,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer Statement
// ─────────────────────────────────────────────────────────────────────────────
export const getCustomerStatement = asyncHandler(async (req, res, next) => {
  const { customerName } = req.params;
  const { fromDate, toDate, page, size } = req.query;

  if (!customerName || customerName.trim().length < 2) {
    return next(
      new Error("Customer name must be at least 2 characters", { cause: 400 }),
    );
  }

  const bookingQuery = {
    "customers.name": { $regex: customerName.trim(), $options: "i" },
  };

  if (fromDate || toDate) {
    bookingQuery.createdAt = {};
    if (fromDate) bookingQuery.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      bookingQuery.createdAt.$lte = to;
    }
  }

  const { limit, skip } = pagination(page, size);

  const [bookings, totalCount, aggregateTotals] = await Promise.all([
    bookingModel
      .find(bookingQuery)
      .populate("provider", "name type")
      .sort({ createdAt: 1 })
      .limit(limit)
      .skip(skip)
      .lean(),
    bookingModel.countDocuments(bookingQuery),
    bookingModel.aggregate([
      { $match: bookingQuery },
      {
        $group: {
          _id: null,
          totalToPay: { $sum: "$totalToPay" },
          totalPaid: { $sum: "$totalPaid" },
          remainingBalance: { $sum: "$remainingBalance" },
        },
      },
    ]),
  ]);

  if (totalCount === 0) {
    return res.status(200).json({
      success: true,
      message: "No bookings found for this customer",
      data: {
        customerName,
        summary: {
          totalBookings: 0,
          totalToPay: 0,
          totalPaid: 0,
          remainingBalance: 0,
        },
        bookings: [],
      },
      errors: null,
    });
  }

  const bookingIds = bookings.map((b) => b._id);
  const payments = await paymentModel
    .find({ booking: { $in: bookingIds } })
    .populate("providerRecipient", "name")
    .lean();

  const paymentsByBooking = {};
  payments.forEach((p) => {
    const key = p.booking.toString();
    if (!paymentsByBooking[key]) paymentsByBooking[key] = [];
    paymentsByBooking[key].push(p);
  });

  const bookingLines = bookings.map((b) => {
    const bPayments = paymentsByBooking[b._id.toString()] || [];
    const paidForThis = bPayments.reduce((s, p) => s + p.amount, 0);

    const matchedCustomer = b.customers?.find((c) =>
      c.name?.toLowerCase().includes(customerName.toLowerCase()),
    );

    return {
      bookingID: b.bookingID,
      mongoId: b._id,
      date: b.createdAt,
      status: b.status,
      paymentStatus: b.paymentStatus,
      provider: b.provider?.name || "N/A",
      customer: matchedCustomer?.name || b.customers?.[0]?.name,
      allCustomers: b.customers,
      totalToPay: b.totalToPay,
      totalPaid: paidForThis,
      remainingBalance: (b.totalToPay || 0) - paidForThis,
      payments: bPayments.map((p) => ({
        amount: p.amount,
        method: p.method,
        date: p.date,
        paidTo: p.providerRecipient?.name || "Office",
      })),
    };
  });

  const grand = aggregateTotals[0] || {
    totalToPay: 0,
    totalPaid: 0,
    remainingBalance: 0,
  };

  return res.status(200).json({
    success: true,
    message: "Customer statement generated successfully",
    data: {
      customerName,
      period: {
        from: fromDate || "All time",
        to: toDate || "All time",
      },
      summary: {
        totalBookings: totalCount,
        totalToPay: grand.totalToPay,
        totalPaid: grand.totalPaid,
        remainingBalance: grand.remainingBalance,
        balanceLabel:
          grand.remainingBalance > 0
            ? `Customer owes: ${grand.remainingBalance}`
            : "Account settled",
      },
      pagination: {
        page: parseInt(page) || 1,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
      },
      bookings: bookingLines,
    },
    errors: null,
  });
});
