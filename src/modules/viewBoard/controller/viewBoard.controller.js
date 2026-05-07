import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import userModel from "../../../../DB/model/user.model.js";
import {
  SERVICE_TYPES,
  SERVICE_TYPE_KEYS,
} from "../../../config/serviceTypes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Period builder
//
// Accepted ?period= values:
//   today | yesterday | last3days | last4days | last5days | last6days |
//   thisweek | thismonth | last3months | last6months | lastyear | all
//
// Returns:
//   current  — { from: Date, to: Date } window for the requested period
//   previous — equivalent prior window for growth comparisons (null for "all")
// ─────────────────────────────────────────────────────────────────────────────
const buildDateRanges = (period = "today") => {
  const now = new Date();

  const dayStart = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const dayEnd = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };
  const monthsAgo = (n) =>
    new Date(now.getFullYear(), now.getMonth() - n, now.getDate());

  const today = dayStart(now);
  const todayClose = dayEnd(now);

  let current, previous;

  switch (period) {
    // ── Day-level periods ───────────────────────────────────────────────────
    case "today": {
      const yd = daysAgo(1);
      current = { from: today, to: todayClose };
      previous = { from: dayStart(yd), to: dayEnd(yd) };
      break;
    }
    case "yesterday": {
      const yd = daysAgo(1);
      const dby = daysAgo(2);
      current = { from: dayStart(yd), to: dayEnd(yd) };
      previous = { from: dayStart(dby), to: dayEnd(dby) };
      break;
    }
    case "last3days": {
      const start = dayStart(daysAgo(2)); // today − 2 → 3 days total
      const prev = dayStart(daysAgo(5));
      const prevE = dayEnd(daysAgo(3));
      current = { from: start, to: todayClose };
      previous = { from: prev, to: prevE };
      break;
    }
    case "last4days": {
      const start = dayStart(daysAgo(3));
      const prev = dayStart(daysAgo(7));
      const prevE = dayEnd(daysAgo(4));
      current = { from: start, to: todayClose };
      previous = { from: prev, to: prevE };
      break;
    }
    case "last5days": {
      const start = dayStart(daysAgo(4));
      const prev = dayStart(daysAgo(9));
      const prevE = dayEnd(daysAgo(5));
      current = { from: start, to: todayClose };
      previous = { from: prev, to: prevE };
      break;
    }
    case "last6days": {
      const start = dayStart(daysAgo(5));
      const prev = dayStart(daysAgo(11));
      const prevE = dayEnd(daysAgo(6));
      current = { from: start, to: todayClose };
      previous = { from: prev, to: prevE };
      break;
    }

    // ── Week / month / multi-month ───────────────────────────────────────────
    case "thisweek": {
      const dow = (now.getDay() + 6) % 7; // Mon = 0
      const weekStart = dayStart(daysAgo(dow));
      const prevEnd = new Date(weekStart.getTime() - 1);
      const prevStart = dayStart(daysAgo(dow + 7));
      current = { from: weekStart, to: todayClose };
      previous = { from: prevStart, to: prevEnd };
      break;
    }
    case "thismonth": {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMEnd = new Date(mStart.getTime() - 1);
      const prevMStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      current = { from: mStart, to: todayClose };
      previous = { from: prevMStart, to: prevMEnd };
      break;
    }
    case "last3months": {
      const start = monthsAgo(3);
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = monthsAgo(6);
      current = { from: start, to: todayClose };
      previous = { from: prevStart, to: prevEnd };
      break;
    }
    case "last6months": {
      const start = monthsAgo(6);
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = monthsAgo(12);
      current = { from: start, to: todayClose };
      previous = { from: prevStart, to: prevEnd };
      break;
    }
    case "lastyear": {
      const start = new Date(
        now.getFullYear() - 1,
        now.getMonth(),
        now.getDate(),
      );
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(
        now.getFullYear() - 2,
        now.getMonth(),
        now.getDate(),
      );
      current = { from: start, to: todayClose };
      previous = { from: prevStart, to: prevEnd };
      break;
    }

    case "all":
    default:
      current = null;
      previous = null;
      break;
  }

  return { current, previous };
};

/** Converts a range object to a Mongoose $match filter on createdAt. */
const createdAtFilter = (range) =>
  range ? { createdAt: { $gte: range.from, $lte: range.to } } : {};

/** Growth percentage string, or null when previous is zero/absent. */
const growth = (curr, prev) =>
  prev > 0 ? `${(((curr - prev) / prev) * 100).toFixed(1)}%` : null;

// ─────────────────────────────────────────────────────────────────────────────
// Internal: extract all service lines from a set of bookings, grouped by
// provider ID.  Returns Map<pid:string, ServiceEntry>.
// ─────────────────────────────────────────────────────────────────────────────

// buildDateRanges, createdAtFilter, growth — unchanged, keep as-is from original

// ─────────────────────────────────────────────────────────────────────────────
// Internal: extract all service lines from a set of bookings, grouped by
// provider ID.  Returns Map<pid:string, ServiceEntry>.
// ─────────────────────────────────────────────────────────────────────────────
const buildServicesMap = (bookings) => {
  const map = new Map();

  const ensure = (pid) => {
    if (!map.has(pid)) {
      map.set(pid, {
        services: [],
        _bookingIds: new Set(),
        periodStats: {
          totalBuy: 0,
          totalSell: 0,
          bookingsCount: 0,
          servicesCount: 0,
        },
      });
    }
    return map.get(pid);
  };

  for (const bk of bookings) {
    const meta = {
      bookingID: bk.bookingID,
      bookingMongoId: bk._id,
      bookingStatus: bk.status,
      paymentStatus: bk.paymentStatus,
      customer: bk.customers?.[0]?.name || "Unknown",
      bookingDate: bk.createdAt,
    };

    for (const service of bk.services || []) {
      if (!service.provider) continue;
      const pid = service.provider.toString();
      const entry = ensure(pid);
      const typeDef = SERVICE_TYPES[service.serviceType];
      const buy = Number(service.buy) || 0;
      const sell = Number(service.sell) || 0;

      entry.services.push({
        ...meta,
        serviceType: service.serviceType,
        serviceLabel: typeDef?.label || service.serviceType,
        serviceNumber: service.serviceNumber,
        buy,
        sell,
        profit: sell - buy,
        duration: service.duration,
        details: service.details || {},
      });

      entry.periodStats.totalBuy += buy;
      entry.periodStats.totalSell += sell;
      entry.periodStats.servicesCount += 1;

      if (!entry._bookingIds.has(bk._id.toString())) {
        entry._bookingIds.add(bk._id.toString());
        entry.periodStats.bookingsCount += 1;
      }
    }
  }

  return map;
};

const shapeProviderFull = (doc, entry) => {
  const stats = entry?.periodStats ?? {
    totalBuy: 0,
    totalSell: 0,
    bookingsCount: 0,
    servicesCount: 0,
  };
  return {
    id: doc._id,
    name: doc.name,
    type: doc.type,
    phone: doc.phone || null,
    address: doc.address || null,
    allTimeSummary: doc.summary || null,
    periodStats: {
      totalBuy: stats.totalBuy,
      totalSell: stats.totalSell,
      totalProfit: stats.totalSell - stats.totalBuy,
      bookingsCount: stats.bookingsCount,
      servicesCount: stats.servicesCount,
    },
    services: (entry?.services ?? []).sort(
      (a, b) => new Date(a.bookingDate) - new Date(b.bookingDate),
    ),
  };
};

const shapeProviderActive = (doc, entry) => {
  const stats = entry.periodStats;
  return {
    id: doc._id,
    name: doc.name,
    type: doc.type,
    phone: doc.phone || null,
    address: doc.address || null,
    periodStats: {
      totalBuy: stats.totalBuy,
      totalSell: stats.totalSell,
      totalProfit: stats.totalSell - stats.totalBuy,
      bookingsCount: stats.bookingsCount,
      servicesCount: stats.servicesCount,
    },
    services: entry.services.sort(
      (a, b) => new Date(a.bookingDate) - new Date(b.bookingDate),
    ),
  };
};

// Keep buildDateRanges, createdAtFilter, growth exactly as in the original file.
// Only paste the two endpoint handlers below, which reference buildServicesMap.

export const getAllProviders = asyncHandler(async (req, res) => {
  // ... (same structure as original, but update the select fields and serviceTypeBreakdown)
  const period = req.query.period || "today";
  const { current, previous } = buildDateRanges(period);
  const curFilter = createdAtFilter(current);
  const prevFilter = createdAtFilter(previous);

  const [
    curStats,
    prevStats,
    overallStats,
    byStatus,
    byPaymentStatus,
    allProviderDocs,
    usersCount,
    totalBookings,
    curBookings,
  ] = await Promise.all([
    bookingModel.aggregate([
      { $match: curFilter },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: "$totalToPay" },
          cost: { $sum: "$totalToBuy" },
          profit: { $sum: "$totalProfit" },
          collected: { $sum: "$totalPaid" },
          outstanding: { $sum: "$remainingBalance" },
        },
      },
    ]),
    prevFilter
      ? bookingModel.aggregate([
          { $match: prevFilter },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              revenue: { $sum: "$totalToPay" },
              profit: { $sum: "$totalProfit" },
            },
          },
        ])
      : Promise.resolve([]),
    bookingModel.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalToPay" },
          totalProfit: { $sum: "$totalProfit" },
          totalCollected: { $sum: "$totalPaid" },
          totalPending: { $sum: "$remainingBalance" },
        },
      },
    ]),
    bookingModel.aggregate([
      { $match: curFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    bookingModel.aggregate([
      { $match: curFilter },
      { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
    ]),
    providerModel.find({}).select("_id name type phone address summary").lean(),
    userModel.countDocuments(),
    bookingModel.countDocuments(),
    bookingModel
      .find(curFilter)
      .select("bookingID status paymentStatus customers createdAt services")
      .lean(),
  ]);

  const cur = curStats[0] || {
    count: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
    collected: 0,
    outstanding: 0,
  };
  const prev = prevStats[0] || { count: 0, revenue: 0, profit: 0 };
  const ov = overallStats[0] || {
    totalRevenue: 0,
    totalProfit: 0,
    totalCollected: 0,
    totalPending: 0,
  };

  const servicesMap = buildServicesMap(curBookings);

  // Dynamic breakdown from registry — no hardcoding
  const serviceTypeBreakdown = Object.fromEntries(
    SERVICE_TYPE_KEYS.map((k) => [k, 0]),
  );
  for (const entry of servicesMap.values()) {
    for (const s of entry.services) {
      if (serviceTypeBreakdown[s.serviceType] !== undefined) {
        serviceTypeBreakdown[s.serviceType]++;
      }
    }
  }

  const providers = allProviderDocs
    .map((doc) => shapeProviderFull(doc, servicesMap.get(doc._id.toString())))
    .sort((a, b) => b.periodStats.totalSell - a.periodStats.totalSell);

  return res.status(200).json({
    success: true,
    message: "Providers retrieved successfully",
    data: {
      period,
      dateRange: current
        ? { from: current.from.toISOString(), to: current.to.toISOString() }
        : { from: "all-time", to: "all-time" },
      summary: {
        bookingsCount: cur.count,
        revenue: cur.revenue,
        cost: cur.cost,
        profit: cur.profit,
        collected: cur.collected,
        outstanding: cur.outstanding,
        revenueGrowth: growth(cur.revenue, prev.revenue),
        bookingsGrowth: growth(cur.count, prev.count),
        profitGrowth: growth(cur.profit, prev.profit),
      },
      overall: {
        totalRevenue: ov.totalRevenue,
        totalProfit: ov.totalProfit,
        totalCollected: ov.totalCollected,
        totalPending: ov.totalPending,
      },
      providers,
      byStatus: Object.fromEntries(byStatus.map((b) => [b._id, b.count])),
      byPaymentStatus: Object.fromEntries(
        byPaymentStatus.map((b) => [b._id, b.count]),
      ),
      serviceTypeBreakdown,
      counts: {
        totalProviders: allProviderDocs.length,
        activeProviders: servicesMap.size,
        users: usersCount,
        totalBookings,
        periodBookings: cur.count,
      },
      metrics: {
        avgBookingValue:
          cur.count > 0 ? +(cur.revenue / cur.count).toFixed(2) : 0,
        avgProfit: cur.count > 0 ? +(cur.profit / cur.count).toFixed(2) : 0,
        collectionRate:
          cur.revenue > 0
            ? `${((cur.collected / cur.revenue) * 100).toFixed(1)}%`
            : "0%",
        profitMargin:
          cur.revenue > 0
            ? `${((cur.profit / cur.revenue) * 100).toFixed(1)}%`
            : "0%",
      },
    },
    errors: null,
  });
});

export const getActiveServices = asyncHandler(async (req, res) => {
  const period = req.query.period || "today";
  const { current, previous } = buildDateRanges(period);
  const curFilter = createdAtFilter(current);
  const prevFilter = createdAtFilter(previous);

  const [curBookings, prevStats, usersCount, totalBookings] = await Promise.all(
    [
      bookingModel
        .find(curFilter)
        .select("bookingID status paymentStatus customers createdAt services")
        .lean(),
      prevFilter
        ? bookingModel.aggregate([
            { $match: prevFilter },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                revenue: { $sum: "$totalToPay" },
                profit: { $sum: "$totalProfit" },
              },
            },
          ])
        : Promise.resolve([]),
      userModel.countDocuments(),
      bookingModel.countDocuments(),
    ],
  );

  const servicesMap = buildServicesMap(curBookings);

  if (servicesMap.size === 0) {
    return res.status(200).json({
      success: true,
      message: "No active services found for this period",
      data: {
        period,
        dateRange: current
          ? { from: current.from.toISOString(), to: current.to.toISOString() }
          : { from: "all-time", to: "all-time" },
        providers: [],
        counts: {
          activeProviders: 0,
          periodBookings: 0,
          periodServices: 0,
          users: usersCount,
          totalBookings,
        },
        metrics: {
          avgBookingValue: 0,
          avgProfit: 0,
          collectionRate: "0%",
          profitMargin: "0%",
        },
      },
      errors: null,
    });
  }

  const activeProviderIds = [...servicesMap.keys()];
  const providerDocs = await providerModel
    .find({ _id: { $in: activeProviderIds } })
    .select("_id name type phone address")
    .lean();

  const docMap = new Map(providerDocs.map((d) => [d._id.toString(), d]));

  const providers = activeProviderIds
    .map((pid) => {
      const doc = docMap.get(pid);
      if (!doc) return null;
      return shapeProviderActive(doc, servicesMap.get(pid));
    })
    .filter(Boolean)
    .sort((a, b) => b.periodStats.totalSell - a.periodStats.totalSell);

  const totals = providers.reduce(
    (acc, p) => {
      acc.revenue += p.periodStats.totalSell;
      acc.cost += p.periodStats.totalBuy;
      acc.profit += p.periodStats.totalProfit;
      acc.bookingsCount += p.periodStats.bookingsCount;
      acc.servicesCount += p.periodStats.servicesCount;
      return acc;
    },
    { revenue: 0, cost: 0, profit: 0, bookingsCount: 0, servicesCount: 0 },
  );

  const prev = prevStats[0] || { count: 0, revenue: 0, profit: 0 };

  return res.status(200).json({
    success: true,
    message: "Active services retrieved successfully",
    data: {
      period,
      dateRange: current
        ? { from: current.from.toISOString(), to: current.to.toISOString() }
        : { from: "all-time", to: "all-time" },
      providers,
      counts: {
        activeProviders: providers.length,
        periodBookings: totals.bookingsCount,
        periodServices: totals.servicesCount,
        users: usersCount,
        totalBookings,
      },
      metrics: {
        totalRevenue: totals.revenue,
        totalCost: totals.cost,
        totalProfit: totals.profit,
        avgBookingValue:
          totals.bookingsCount > 0
            ? +(totals.revenue / totals.bookingsCount).toFixed(2)
            : 0,
        avgProfit:
          totals.bookingsCount > 0
            ? +(totals.profit / totals.bookingsCount).toFixed(2)
            : 0,
        collectionRate:
          totals.revenue > 0
            ? `${((totals.revenue / totals.revenue) * 100).toFixed(1)}%`
            : "0%",
        profitMargin:
          totals.revenue > 0
            ? `${((totals.profit / totals.revenue) * 100).toFixed(1)}%`
            : "0%",
        revenueGrowth: growth(totals.revenue, prev.revenue),
        bookingsGrowth: growth(totals.bookingsCount, prev.count),
        profitGrowth: growth(totals.profit, prev.profit),
      },
    },
    errors: null,
  });
});
