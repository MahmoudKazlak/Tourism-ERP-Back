import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel         from "../../../../DB/model/booking.model.js";
import paymentModel         from "../../../../DB/model/payment.model.js";
import expenseModel         from "../../../../DB/model/expense.model.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";

// ── Safety cap ────────────────────────────────────────────────────────────────
/**
 * Hard limit on CSV report rows to prevent accidental memory exhaustion.
 *
 * Without a limit, a date-range query spanning years could pull tens of
 * thousands of documents into the Node heap in one shot.
 * The /export/full endpoint uses cursor-based streaming and is not affected.
 *
 * When the cap is hit a `X-Report-Truncated: true` header is set so the
 * frontend can display a warning to the user.
 */
const REPORT_MAX_ROWS = 10_000;

// ── CSV helpers ───────────────────────────────────────────────────────────────

const toCSV = (headers, rows) => {
  const escape = (value) => {
    if (value == null) return "";
    const str = String(value).replace(/"/g, '""');
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str}"`
      : str;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\n");
};

const sendCSV = (res, filename, csv) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // UTF-8 BOM so Excel opens Arabic / mixed-language content correctly.
  res.send("\uFEFF" + csv);
};

// ─────────────────────────────────────────────────────────────────────────────
// Bookings report
// GET /api/v1/report/bookings?fromDate=&toDate=&status=&paymentStatus=
// ─────────────────────────────────────────────────────────────────────────────
export const exportBookings = asyncHandler(async (req, res) => {
  const { fromDate, toDate, status, paymentStatus } = req.query;

  const query = {};
  if (status)        query.status        = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.createdAt.$lte = to;
    }
  }

  const bookings = await bookingModel
    .find(query)
    .populate("provider",  "name type")
    .populate("createdBy", "userName")
    .sort({ bookingID: 1 })
    .limit(REPORT_MAX_ROWS)
    .lean();

  if (bookings.length === REPORT_MAX_ROWS) {
    res.setHeader("X-Report-Truncated", "true");
  }

  const headers = [
    "bookingID", "date", "status", "paymentStatus", "provider",
    "customers", "totalToPay", "totalPaid", "remainingBalance",
    "totalProfit", "createdBy",
  ];

  const rows = bookings.map((b) => ({
    bookingID:        b.bookingID,
    date:             b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "",
    status:           b.status,
    paymentStatus:    b.paymentStatus,
    provider:         b.provider?.name || "",
    customers:        b.customers?.map((c) => c.name).join(" | ") || "",
    totalToPay:       b.totalToPay,
    totalPaid:        b.totalPaid,
    remainingBalance: b.remainingBalance,
    totalProfit:      b.totalProfit,
    createdBy:        b.createdBy?.userName || "",
  }));

  const dateTag = fromDate || toDate ? `_${fromDate || ""}_to_${toDate || ""}` : "";
  sendCSV(res, `bookings${dateTag}.csv`, toCSV(headers, rows));
});

// ─────────────────────────────────────────────────────────────────────────────
// Payments report
// GET /api/v1/report/payments?fromDate=&toDate=&method=
// ─────────────────────────────────────────────────────────────────────────────
export const exportPayments = asyncHandler(async (req, res) => {
  const { fromDate, toDate, method } = req.query;

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

  const payments = await paymentModel
    .find(query)
    .populate("booking",    "bookingID")
    .populate("recordedBy", "userName")
    .sort({ date: -1 })
    .limit(REPORT_MAX_ROWS)
    .lean();

  if (payments.length === REPORT_MAX_ROWS) {
    res.setHeader("X-Report-Truncated", "true");
  }

  const headers = ["bookingID", "date", "amount", "method", "notes", "recordedBy"];

  const rows = payments.map((p) => ({
    bookingID:  p.booking?.bookingID || p.bookingID || "",
    date:       p.date ? new Date(p.date).toLocaleDateString() : "",
    amount:     p.amount,
    method:     p.method,
    notes:      p.notes || "",
    recordedBy: p.recordedBy?.userName || "",
  }));

  const dateTag = fromDate || toDate ? `_${fromDate || ""}_to_${toDate || ""}` : "";
  sendCSV(res, `payments${dateTag}.csv`, toCSV(headers, rows));
});

// ─────────────────────────────────────────────────────────────────────────────
// Expenses report
// GET /api/v1/report/expenses?fromDate=&toDate=&category=
// ─────────────────────────────────────────────────────────────────────────────
export const exportExpenses = asyncHandler(async (req, res) => {
  const { fromDate, toDate, category } = req.query;

  const query = {};
  if (category) query.category = category;
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.date.$lte = to;
    }
  }

  const expenses = await expenseModel
    .find(query)
    .populate("recordedBy", "userName")
    .sort({ date: -1 })
    .limit(REPORT_MAX_ROWS)
    .lean();

  if (expenses.length === REPORT_MAX_ROWS) {
    res.setHeader("X-Report-Truncated", "true");
  }

  const headers = [
    "date", "category", "description", "amount",
    "method", "reference", "recordedBy",
  ];

  const rows = expenses.map((e) => ({
    date:        e.date ? new Date(e.date).toLocaleDateString() : "",
    category:    e.category,
    description: e.description,
    amount:      e.amount,
    method:      e.method,
    reference:   e.reference || "",
    recordedBy:  e.recordedBy?.userName || "",
  }));

  const dateTag = fromDate || toDate ? `_${fromDate || ""}_to_${toDate || ""}` : "";
  sendCSV(res, `expenses${dateTag}.csv`, toCSV(headers, rows));
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider payments report
// GET /api/v1/report/provider-payments?fromDate=&toDate=
// ─────────────────────────────────────────────────────────────────────────────
export const exportProviderPayments = asyncHandler(async (req, res) => {
  const { fromDate, toDate } = req.query;

  const query = {};
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.date.$lte = to;
    }
  }

  const payments = await providerPaymentModel
    .find(query)
    .populate("provider",   "name type")
    .populate("recordedBy", "userName")
    .sort({ date: -1 })
    .limit(REPORT_MAX_ROWS)
    .lean();

  if (payments.length === REPORT_MAX_ROWS) {
    res.setHeader("X-Report-Truncated", "true");
  }

  const headers = [
    "date", "provider", "providerType", "amount",
    "method", "reference", "notes", "recordedBy",
  ];

  const rows = payments.map((p) => ({
    date:         p.date ? new Date(p.date).toLocaleDateString() : "",
    provider:     p.provider?.name || "",
    providerType: p.provider?.type || "",
    amount:       p.amount,
    method:       p.method,
    reference:    p.reference || "",
    notes:        p.notes || "",
    recordedBy:   p.recordedBy?.userName || "",
  }));

  const dateTag = fromDate || toDate ? `_${fromDate || ""}_to_${toDate || ""}` : "";
  sendCSV(res, `provider-payments${dateTag}.csv`, toCSV(headers, rows));
});

// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss summary
// GET /api/v1/report/pnl?fromDate=&toDate=
// ─────────────────────────────────────────────────────────────────────────────
export const getProfitLoss = asyncHandler(async (req, res) => {
  const { fromDate, toDate } = req.query;

  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    dateFilter.$lte = to;
  }

  const bookingQuery  = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
  const financeQuery  = Object.keys(dateFilter).length ? { date:      dateFilter } : {};

  const [bookingAgg, expenseAgg, providerPaymentAgg] = await Promise.all([
    bookingModel.aggregate([
      { $match: bookingQuery },
      {
        $group: {
          _id:          null,
          totalRevenue: { $sum: "$totalToPay"  },
          totalPaid:    { $sum: "$totalPaid"   },
          totalProfit:  { $sum: "$totalProfit" },
          totalCost:    { $sum: "$totalBuy"    },
          bookingCount: { $sum: 1              },
        },
      },
    ]),
    expenseModel.aggregate([
      { $match: financeQuery },
      { $group: { _id: null, totalExpenses: { $sum: "$amount" }, expenseCount: { $sum: 1 } } },
    ]),
    providerPaymentModel.aggregate([
      { $match: financeQuery },
      { $group: { _id: null, totalProviderPayments: { $sum: "$amount" }, paymentCount: { $sum: 1 } } },
    ]),
  ]);

  const b  = bookingAgg[0]         || {};
  const e  = expenseAgg[0]         || {};
  const pp = providerPaymentAgg[0] || {};

  return res.status(200).json({
    success: true,
    message: "Profit & Loss summary retrieved",
    data: {
      period: {
        from: fromDate || null,
        to:   toDate   || null,
      },
      bookings: {
        count:        b.bookingCount  || 0,
        totalRevenue: b.totalRevenue  || 0,
        totalPaid:    b.totalPaid     || 0,
        totalCost:    b.totalCost     || 0,
        grossProfit:  b.totalProfit   || 0,
      },
      expenses: {
        count: e.expenseCount || 0,
        total: e.totalExpenses || 0,
      },
      providerPayments: {
        count: pp.paymentCount         || 0,
        total: pp.totalProviderPayments || 0,
      },
      netProfit:
        (b.totalProfit || 0) - (e.totalExpenses || 0),
    },
    errors: null,
  });
});
