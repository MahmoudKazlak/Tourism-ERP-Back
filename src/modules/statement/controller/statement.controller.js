import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import providerCollectionModel from "../../../../DB/model/providerCollection.model.js";
import {
  describeService,
} from "../../../config/serviceTypes.js";
import { getMergedServiceTypes } from "../../../services/serviceTypeRegistry.js";
import { pagination } from "../../../services/pagination.js";

const buildLedger = async (providerId, dateFilter) => {
  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const providerObjId = new mongoose.Types.ObjectId(providerId);

  const bookingQuery = {
    $or: [{ provider: providerId }, { "services.provider": providerId }],
  };
  if (hasDateFilter) bookingQuery.createdAt = dateFilter;

  const providerPaymentQuery = { provider: providerId };
  if (hasDateFilter) providerPaymentQuery.date = dateFilter;

  const directPaymentQuery = { providerRecipient: providerObjId };
  if (hasDateFilter) directPaymentQuery.date = dateFilter;

  const collectionQuery = { provider: providerId };
  if (hasDateFilter) collectionQuery.date = dateFilter;

  const [bookings, providerPaymentsList, directPaymentsList, collectionsList] =
    await Promise.all([
      bookingModel.find(bookingQuery).lean(),
      providerPaymentModel
        .find(providerPaymentQuery)
        .populate("recordedBy", "userName")
        .sort({ date: 1 })
        .lean(),
      paymentModel
        .find(directPaymentQuery)
        .populate("booking", "bookingID customers")
        .populate("recordedBy", "userName")
        .sort({ date: 1 })
        .lean(),
      providerCollectionModel
        .find(collectionQuery)
        .populate("recordedBy", "userName")
        .populate("booking", "bookingID customers")
        .sort({ date: 1 })
        .lean(),
    ]);

  // ── Service debit lines ───────────────────────────────────────────────────
  const serviceLines = [];
  for (const booking of bookings) {
    const meta = {
      bookingID: booking.bookingID,
      bookingMongoId: booking._id,
      customer: booking.customers?.[0]?.name || "Unknown",
      date: booking.createdAt,
    };

    for (const service of booking.services || []) {
      const pid =
        service.provider?._id?.toString() || service.provider?.toString();
      if (pid !== providerId) continue;

      const typeDef = getMergedServiceTypes()[service.serviceType];
      serviceLines.push({
        ...meta,
        type: "SERVICE_DEBIT",
        serviceType: service.serviceType,
        serviceLabel: typeDef?.label || service.serviceType,
        description: describeService(service),
        debit: Number(service.buy) || 0,
        credit: 0,
      });
    }
  }

  // ── Agency payment credit lines ───────────────────────────────────────────
  const agencyPaymentLines = providerPaymentsList.map((p) => ({
    date: p.date,
    type: "AGENCY_PAYMENT",
    description:
      `Payment by ${p.recordedBy?.userName || "office"}` +
      (p.reference ? ` — Ref: ${p.reference}` : ""),
    debit: 0,
    credit: Number(p.amount),
    method: p.method,
    reference: p.reference || null,
  }));

  // ── Customer direct payment credit lines ──────────────────────────────────
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

  // ── Provider collection debit lines ──────────────────────────────────────
  const collectionLines = collectionsList.map((c) => ({
    date: c.date,
    type: "AGENCY_COLLECTION",
    description:
      `Agency collected from provider` +
      (c.booking?.bookingID ? ` (Booking #${c.booking.bookingID})` : "") +
      (c.reference ? ` — Ref: ${c.reference}` : ""),
    debit: Number(c.amount),
    credit: 0,
    method: c.method,
    reference: c.reference || null,
  }));

  const ledger = [
    ...serviceLines,
    ...agencyPaymentLines,
    ...directPaymentLines,
    ...collectionLines,
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    ledger,
    _rawTotals: {
      totalServiceCost: serviceLines.reduce((s, l) => s + l.debit, 0),
      totalWeHavePaid: agencyPaymentLines.reduce((s, l) => s + l.credit, 0),
      totalCustomersPaidDirect: directPaymentLines.reduce(
        (s, l) => s + l.credit,
        0,
      ),
      totalCollectedFromProvider: collectionLines.reduce(
        (s, l) => s + l.debit,
        0,
      ),
    },
  };
};

const buildSummaryFromRaw = ({
  totalServiceCost,
  totalWeHavePaid,
  totalCustomersPaidDirect,
  totalCollectedFromProvider,
}) => {
  const totalCredits = totalWeHavePaid + totalCustomersPaidDirect;
  const outstandingBalance =
    totalServiceCost - totalCredits + totalCollectedFromProvider;

  let balanceType, balanceLabel;
  if (Math.abs(outstandingBalance) < 0.01) {
    balanceLabel = "Account settled — no outstanding balance";
    balanceType = "settled";
  } else if (outstandingBalance > 0) {
    balanceLabel = `Agency owes provider: $${outstandingBalance.toFixed(2)}`;
    balanceType = "we_owe_provider";
  } else {
    balanceLabel = `Provider owes agency: $${Math.abs(outstandingBalance).toFixed(2)}`;
    balanceType = "provider_owes_us";
  }

  return {
    totalServiceCost,
    totalWeHavePaid,
    totalCustomersPaidDirect,
    totalCredits,
    totalCollectedFromProvider,
    outstandingBalance,
    balanceType,
    balanceLabel,
    breakdown:
      outstandingBalance < -0.01
        ? {
            amountProviderOwesUs: Math.abs(totalServiceCost - totalCredits),
            alreadyRecovered: totalCollectedFromProvider,
            stillToCollect: Math.abs(outstandingBalance),
          }
        : outstandingBalance > 0.01
          ? {
              totalServiceCost,
              alreadyPaid: totalCredits,
              stillToPay: outstandingBalance,
            }
          : { note: "Account is fully settled" },
  };
};

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

  const hasDateFilter = Object.keys(dateFilter).length > 0;
  const { ledger, _rawTotals } = await buildLedger(providerId, dateFilter);

  let summary;
  if (!hasDateFilter) {
    const s = provider.summary;
    const outstandingBalance = s.currentBalance;
    summary = {
      totalServiceCost: s.totalBuy,
      totalWeHavePaid: s.totalWeHavePaid,
      totalCustomersPaidDirect: s.totalCustomersPaidDirect,
      totalCredits: s.totalCredits,
      totalCollectedFromProvider: s.totalCollectedFromProvider,
      outstandingBalance,
      balanceType: s.balanceType,
      balanceLabel: s.balanceLabel,
      _cachedSummary: true,
      lastSynced: s.lastSynced,
      breakdown:
        outstandingBalance < -0.01
          ? {
              amountProviderOwesUs: Math.abs(s.totalBuy - s.totalCredits),
              alreadyRecovered: s.totalCollectedFromProvider,
              stillToCollect: Math.abs(outstandingBalance),
            }
          : outstandingBalance > 0.01
            ? {
                totalServiceCost: s.totalBuy,
                alreadyPaid: s.totalCredits,
                stillToPay: outstandingBalance,
              }
            : { note: "Account is fully settled" },
    };
  } else {
    summary = { ...buildSummaryFromRaw(_rawTotals), _cachedSummary: false };
  }

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
      period: { from: fromDate || "All time", to: toDate || "All time" },
      summary,
      ledger,
    },
    errors: null,
  });
});

// getCustomerStatement is unchanged — copy from original as-is
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
      period: { from: fromDate || "All time", to: toDate || "All time" },
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
