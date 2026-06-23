/**
 * export.service.js
 * ─────────────────
 * Orchestrates the full Excel export. Sheets are written sequentially
 * (not in parallel) so only one MongoDB cursor is open at a time,
 * keeping the server's memory footprint constant regardless of data volume.
 */
import * as BookingRepo  from "./repositories/booking.repository.js";
import * as PaymentRepo  from "./repositories/payment.repository.js";
import * as ProviderRepo from "./repositories/provider.repository.js";
import * as ExpenseRepo  from "./repositories/expense.repository.js";
import * as UserRepo     from "./repositories/user.repository.js";
import {
  createStreamingWorkbook,
  addStyledSheet,
  addDataRow,
  addSummarySheet,
} from "./utils/excel.builder.js";
import {
  fmtDate,
  fmtCurrency,
  fmtBool,
  fmtList,
  fmtTruncate,
} from "./utils/cell.formatters.js";

// ── Column schemas ────────────────────────────────────────────────────────────
const BOOKINGS_COLS = [
  { header: "Booking #",      key: "bookingID",        width: 12, type: "number"   },
  { header: "Date",           key: "date",             width: 14, type: "date"     },
  { header: "Status",         key: "status",           width: 14                   },
  { header: "Payment Status", key: "paymentStatus",    width: 16                   },
  { header: "Main Provider",  key: "provider",         width: 26                   },
  { header: "Provider Type",  key: "providerType",     width: 16                   },
  { header: "Customer(s)",    key: "customers",        width: 32                   },
  { header: "Services",       key: "servicesCount",    width: 10, type: "number"   },
  { header: "Invoice (sell)", key: "totalToPay",       width: 16, type: "currency" },
  { header: "Cost (buy)",     key: "totalToBuy",       width: 16, type: "currency" },
  { header: "Gross Profit",   key: "totalProfit",      width: 16, type: "currency" },
  { header: "Collected",      key: "totalPaid",        width: 16, type: "currency" },
  { header: "Remaining",      key: "remainingBalance", width: 16, type: "currency" },
  { header: "Created By",     key: "createdBy",        width: 18                   },
];

const SERVICES_COLS = [
  { header: "Booking #",      key: "bookingID",     width: 12, type: "number"   },
  { header: "Booking Date",   key: "bookingDate",   width: 14, type: "date"     },
  { header: "Booking Status", key: "bookingStatus", width: 14                   },
  { header: "Customer",       key: "customer",      width: 26                   },
  { header: "Service Type",   key: "serviceType",   width: 18                   },
  { header: "Service #",      key: "serviceNumber", width: 12, type: "number"   },
  { header: "Provider",       key: "providerName",  width: 26                   },
  { header: "Buy (cost)",     key: "buy",           width: 14, type: "currency" },
  { header: "Sell (revenue)", key: "sell",          width: 14, type: "currency" },
  { header: "Profit",         key: "profit",        width: 14, type: "currency" },
  { header: "Duration",       key: "duration",      width: 10, type: "number"   },
  { header: "Details",        key: "details",       width: 40                   },
];

const PAYMENTS_COLS = [
  { header: "Date",        key: "date",       width: 14, type: "date"     },
  { header: "Booking #",   key: "bookingID",  width: 12, type: "number"   },
  { header: "Customer",    key: "customer",   width: 26                   },
  { header: "Amount",      key: "amount",     width: 14, type: "currency" },
  { header: "Method",      key: "method",     width: 16                   },
  { header: "Paid To",     key: "paidTo",     width: 22                   },
  { header: "Notes",       key: "notes",      width: 30                   },
  { header: "Recorded By", key: "recordedBy", width: 18                   },
];

const PROVIDERS_COLS = [
  { header: "Name",           key: "name",             width: 28                   },
  { header: "Type",           key: "type",             width: 18                   },
  { header: "Phone",          key: "phone",            width: 18                   },
  { header: "Address",        key: "address",          width: 32                   },
  { header: "Total Bookings", key: "totalBookings",    width: 16, type: "number"   },
  { header: "Total Buy",      key: "totalBuy",         width: 16, type: "currency" },
  { header: "Total Sell",     key: "totalSell",        width: 16, type: "currency" },
  { header: "We Paid",        key: "totalWeHavePaid",  width: 16, type: "currency" },
  { header: "Cust. Direct",   key: "customersDirect",  width: 16, type: "currency" },
  { header: "Collected Back", key: "collectedBack",    width: 16, type: "currency" },
  { header: "Balance",        key: "currentBalance",   width: 16, type: "currency" },
  { header: "Balance Type",   key: "balanceType",      width: 20                   },
  { header: "Last Synced",    key: "lastSynced",       width: 18, type: "date"     },
];

const PROV_PAYMENTS_COLS = [
  { header: "Date",        key: "date",       width: 14, type: "date"     },
  { header: "Provider",    key: "provider",   width: 26                   },
  { header: "Type",        key: "type",       width: 16                   },
  { header: "Amount",      key: "amount",     width: 14, type: "currency" },
  { header: "Method",      key: "method",     width: 16                   },
  { header: "Reference",   key: "reference",  width: 20                   },
  { header: "Notes",       key: "notes",      width: 30                   },
  { header: "Recorded By", key: "recordedBy", width: 18                   },
];

const COLLECTIONS_COLS = [
  { header: "Date",             key: "date",       width: 14, type: "date"     },
  { header: "Provider",         key: "provider",   width: 26                   },
  { header: "Amount",           key: "amount",     width: 14, type: "currency" },
  { header: "Method",           key: "method",     width: 16                   },
  { header: "Related Booking",  key: "bookingID",  width: 16, type: "number"   },
  { header: "Reference",        key: "reference",  width: 20                   },
  { header: "Notes",            key: "notes",      width: 30                   },
  { header: "Recorded By",      key: "recordedBy", width: 18                   },
];

const EXPENSES_COLS = [
  { header: "Date",        key: "date",        width: 14, type: "date"     },
  { header: "Category",    key: "category",    width: 16                   },
  { header: "Description", key: "description", width: 38                   },
  { header: "Amount",      key: "amount",      width: 14, type: "currency" },
  { header: "Method",      key: "method",      width: 16                   },
  { header: "Reference",   key: "reference",   width: 20                   },
  { header: "Recorded By", key: "recordedBy",  width: 18                   },
];

const USERS_COLS = [
  { header: "Username", key: "userName",  width: 22                 },
  { header: "Email",    key: "email",     width: 32                 },
  { header: "Role",     key: "role",      width: 20                 },
  { header: "Blocked",  key: "blocked",   width: 10                 },
  { header: "Created",  key: "createdAt", width: 18, type: "date"  },
];

// ── Core streaming helper ─────────────────────────────────────────────────────
/**
 * Iterates a MongoDB cursor and writes each doc as a committed row.
 * Memory usage is bounded to one batchSize of documents at a time.
 */
const pipeCursorToSheet = async (cursor, sheet, transform) => {
  let i = 0;
  for await (const doc of cursor) {
    addDataRow(sheet, transform(doc), ++i);
  }
  await sheet.commit();
  return i;
};

// ── Main export ───────────────────────────────────────────────────────────────
export const generateFullExport = async (writableStream, filename) => {
  const workbook = createStreamingWorkbook(writableStream, filename);

  // Lightweight aggregates — run in parallel, small result sets
  const [bSum, eSum, pSum, ppSum, pvSum] = await Promise.all([
    BookingRepo.getBookingSummary(),
    ExpenseRepo.getExpenseSummary(),
    PaymentRepo.getPaymentSummary(),
    PaymentRepo.getProviderPaymentSummary(),
    ProviderRepo.getProviderSummary(),
  ]);

  const bs = bSum[0]  ?? {};
  const es = eSum[0]  ?? {};
  const ps = pSum[0]  ?? {};
  const pp = ppSum[0] ?? {};
  const pv = pvSum[0] ?? {};
  const netProfit = (bs.totalProfit ?? 0) - (es.total ?? 0);

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  addSummarySheet(workbook, [
    ["Bookings",                        "",                               true  ],
    ["Total Bookings",                  bs.totalBookings ?? 0                   ],
    ["Total Revenue (sell)",            fmtCurrency(bs.totalRevenue)            ],
    ["Total Cost (buy)",                fmtCurrency(bs.totalCost)               ],
    ["Gross Profit",                    fmtCurrency(bs.totalProfit)             ],
    ["Collected from Customers",        fmtCurrency(bs.totalPaid)               ],
    ["Outstanding from Customers",      fmtCurrency(bs.totalOutstanding)        ],
    ["",                                "",                               false ],
    ["Providers",                       "",                               true  ],
    ["Total Providers",                 pv.totalProviders ?? 0                  ],
    ["Total Services Buy",              fmtCurrency(pv.totalBuy)                ],
    ["Total Services Sell",             fmtCurrency(pv.totalSell)               ],
    ["Net Provider Balance",            fmtCurrency(pv.totalWeOwed)             ],
    ["Total Paid to Providers",         fmtCurrency(pp.total)                   ],
    ["",                                "",                               false ],
    ["Expenses",                        "",                               true  ],
    ["Total Operating Expenses",        fmtCurrency(es.total)                   ],
    ["Expense Records",                 es.count ?? 0                           ],
    ["",                                "",                               false ],
    ["Net Result",                      "",                               true  ],
    ["Net Profit  (Gross − Expenses)",  fmtCurrency(netProfit)                  ],
    ["Customer Payments Collected",     fmtCurrency(ps.total)                   ],
  ]);

  // Sheets 2-8: one cursor open at a time ────────────────────────────────────

  // Sheet 2: Bookings
  await pipeCursorToSheet(
    BookingRepo.streamBookings(),
    addStyledSheet(workbook, "📋 Bookings", BOOKINGS_COLS),
    (b) => ({
      bookingID:        b.bookingID,
      date:             fmtDate(b.createdAt),
      status:           b.status,
      paymentStatus:    b.paymentStatus,
      provider:         b.provider?.name ?? "",
      providerType:     b.provider?.type?.replace(/_/g, " ") ?? "",
      customers:        fmtList(b.customers, "name"),
      servicesCount:    b.services?.length ?? 0,
      totalToPay:       b.totalToPay,
      totalToBuy:       b.totalToBuy,
      totalProfit:      b.totalProfit,
      totalPaid:        b.totalPaid,
      remainingBalance: b.remainingBalance,
      createdBy:        b.createdBy?.userName ?? "",
    }),
  );

  // Sheet 3: Services (flattened via $unwind + $lookup in the repository)
  await pipeCursorToSheet(
    BookingRepo.streamServices(),
    addStyledSheet(workbook, "🔧 Services", SERVICES_COLS),
    (s) => ({
      bookingID:     s.bookingID,
      bookingDate:   fmtDate(s.bookingDate),
      bookingStatus: s.bookingStatus,
      customer:      s.customer ?? "",
      serviceType:   s.serviceType,
      serviceNumber: s.serviceNumber ?? "",
      providerName:  s.providerName  ?? "",
      buy:           s.buy,
      sell:          s.sell,
      profit:        s.profit,
      duration:      s.duration ?? "",
      details:       fmtTruncate(JSON.stringify(s.details ?? {}), 120),
    }),
  );

  // Sheet 4: Customer Payments
  await pipeCursorToSheet(
    PaymentRepo.streamPayments(),
    addStyledSheet(workbook, "💰 Customer Payments", PAYMENTS_COLS),
    (p) => ({
      date:       fmtDate(p.date),
      bookingID:  p.booking?.bookingID ?? p.bookingID ?? "",
      customer:   p.booking?.customers?.[0]?.name ?? "",
      amount:     p.amount,
      method:     p.method?.replace(/_/g, " ") ?? "",
      paidTo:     p.providerRecipient?.name ?? "Office",
      notes:      fmtTruncate(p.notes ?? "", 80),
      recordedBy: p.recordedBy?.userName ?? "",
    }),
  );

  // Sheet 5: Providers
  await pipeCursorToSheet(
    ProviderRepo.streamProviders(),
    addStyledSheet(workbook, "🏢 Providers", PROVIDERS_COLS),
    (p) => ({
      name:            p.name,
      type:            p.type?.replace(/_/g, " ") ?? "",
      phone:           p.phone   ?? "",
      address:         p.address ?? "",
      totalBookings:   p.totalBookings ?? 0,
      totalBuy:        p.summary?.totalBuy                   ?? 0,
      totalSell:       p.summary?.totalSell                  ?? 0,
      totalWeHavePaid: p.summary?.totalWeHavePaid            ?? 0,
      customersDirect: p.summary?.totalCustomersPaidDirect   ?? 0,
      collectedBack:   p.summary?.totalCollectedFromProvider ?? 0,
      currentBalance:  p.summary?.currentBalance             ?? 0,
      balanceType:     p.summary?.balanceType?.replace(/_/g, " ") ?? "settled",
      lastSynced:      fmtDate(p.summary?.lastSynced),
    }),
  );

  // Sheet 6: Provider Payments
  await pipeCursorToSheet(
    PaymentRepo.streamProviderPayments(),
    addStyledSheet(workbook, "💸 Provider Payments", PROV_PAYMENTS_COLS),
    (p) => ({
      date:       fmtDate(p.date),
      provider:   p.provider?.name ?? "",
      type:       p.provider?.type?.replace(/_/g, " ") ?? "",
      amount:     p.amount,
      method:     p.method?.replace(/_/g, " ") ?? "",
      reference:  p.reference ?? "",
      notes:      fmtTruncate(p.notes ?? "", 80),
      recordedBy: p.recordedBy?.userName ?? "",
    }),
  );

  // Sheet 7: Provider Collections
  await pipeCursorToSheet(
    PaymentRepo.streamProviderCollections(),
    addStyledSheet(workbook, "📥 Collections", COLLECTIONS_COLS),
    (c) => ({
      date:       fmtDate(c.date),
      provider:   c.provider?.name ?? "",
      amount:     c.amount,
      method:     c.method?.replace(/_/g, " ") ?? "",
      bookingID:  c.booking?.bookingID ?? "",
      reference:  c.reference ?? "",
      notes:      fmtTruncate(c.notes ?? "", 80),
      recordedBy: c.recordedBy?.userName ?? "",
    }),
  );

  // Sheet 8: Expenses
  await pipeCursorToSheet(
    ExpenseRepo.streamExpenses(),
    addStyledSheet(workbook, "🧾 Expenses", EXPENSES_COLS),
    (e) => ({
      date:        fmtDate(e.date),
      category:    e.category,
      description: fmtTruncate(e.description, 80),
      amount:      e.amount,
      method:      e.method?.replace(/_/g, " ") ?? "",
      reference:   e.reference ?? "",
      recordedBy:  e.recordedBy?.userName ?? "",
    }),
  );

  // Sheet 9: Users (passwords already excluded at repository layer)
  await pipeCursorToSheet(
    UserRepo.streamUsers(),
    addStyledSheet(workbook, "👤 Users", USERS_COLS),
    (u) => ({
      userName:  u.userName,
      email:     u.email,
      role:      u.role?.replace(/_/g, " ") ?? "",
      blocked:   fmtBool(u.blocked),
      createdAt: fmtDate(u.createdAt),
    }),
  );

  // Finalise — writes ZIP footer, closes the HTTP response
  await workbook.commit();
};
