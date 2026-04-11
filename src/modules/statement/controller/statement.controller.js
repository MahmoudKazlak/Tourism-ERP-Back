import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import { pagination } from "../../../services/pagination.js";

// ─────────────────────────────────────────────────────────────────────────────
// Provider statement
//
// Feature [1]: Now also returns totalPaidToProvider from the
// ProviderPayment collection, completing both sides of the ledger.
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderStatement = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { fromDate, toDate } = req.query;

  const provider = await providerModel.findById(providerId);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    dateFilter.$lte = to;
  }

  const bookingQuery = {
    $or: [
      { provider: providerId },
      { "accommodations.hotel": providerId },
      { "carRentals.provider": providerId },
      { "tripsWithDrivers.provider": providerId },
    ],
  };
  if (Object.keys(dateFilter).length) bookingQuery.createdAt = dateFilter;

  // Run bookings and provider payments queries in parallel.
  const providerPaymentQuery = { provider: providerId };
  if (Object.keys(dateFilter).length) providerPaymentQuery.date = dateFilter;

  const [bookings, providerPaymentsResult] = await Promise.all([
    bookingModel
      .find(bookingQuery)
      .populate(
        "accommodations.hotel carRentals.provider tripsWithDrivers.provider",
      )
      .lean(),
    providerPaymentModel.aggregate([
      { $match: providerPaymentQuery },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const serviceLines = [];
  let totalCostFromProvider = 0;

  bookings.forEach((booking) => {
    const addLines = (items, serviceType, providerKey, getLabel) => {
      items?.forEach((item) => {
        const pid =
          item[providerKey]?._id?.toString() || item[providerKey]?.toString();
        if (pid !== providerId) return;

        const buy = Number(item.buy) || 0;
        totalCostFromProvider += buy;

        serviceLines.push({
          bookingID: booking.bookingID,
          bookingMongoId: booking._id,
          customer: booking.customers?.[0]?.name || "Unknown",
          date: booking.createdAt,
          serviceType,
          label: getLabel(item),
          costToPay: buy,
        });
      });
    };

    addLines(
      booking.accommodations,
      "Hotel",
      "hotel",
      (a) =>
        `${a.roomType || ""} - ${a.board || ""} - ${a.duration || 0} Nights`,
    );
    addLines(
      booking.carRentals,
      "Car Rental",
      "provider",
      (c) =>
        `${c.brand || ""} - ${c.pickUp ? new Date(c.pickUp).toLocaleDateString("ar") : "N/A"}`,
    );
    addLines(
      booking.tripsWithDrivers,
      "Trip",
      "provider",
      (t) => `${t.brand || ""} - Driver: ${t.driverName || ""}`,
    );
  });

  const totalPaidToProvider = providerPaymentsResult[0]?.total || 0;
  const outstandingBalance = totalCostFromProvider - totalPaidToProvider;

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
        totalTransactions: serviceLines.length,
        // What you OWE the provider across all service lines.
        totalCostFromProvider,
        // What you have already PAID the provider.
        totalPaidToProvider,
        // Positive = still owe provider; negative = overpaid.
        outstandingBalance,
        balanceLabel:
          outstandingBalance > 0
            ? `Outstanding: ${outstandingBalance}`
            : outstandingBalance < 0
              ? `Overpaid by: ${Math.abs(outstandingBalance)}`
              : "Account settled",
      },
      lines: serviceLines.sort((a, b) => new Date(a.date) - new Date(b.date)),
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer statement
//
// Fix [8]: Added pagination — previously returned all matching bookings
// in one unbounded query.
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

  // Aggregate totals (all pages) and paginated bookings in parallel.
  const [bookings, totalCount, aggregateTotals] = await Promise.all([
    bookingModel
      .find(bookingQuery)
      .populate("provider", "name type")
      .sort({ createdAt: 1 })
      .limit(limit)
      .skip(skip)
      .lean(),
    bookingModel.countDocuments(bookingQuery),
    // Get grand totals across ALL pages (not just the current page).
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

  // Fetch payments only for the bookings on this page.
  const bookingIds = bookings.map((b) => b._id);
  const payments = await paymentModel
    .find({ booking: { $in: bookingIds } })
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
      // Grand totals are always across ALL bookings, regardless of page.
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
      // Pagination metadata
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
