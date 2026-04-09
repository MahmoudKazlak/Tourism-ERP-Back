import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import userModel from "../../../../DB/model/user.model.js";

export const getDashboard = asyncHandler(async (req, res, next) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
  );

  // FIX: استبدال find().lean() بـ aggregate — أسرع بكثير مع بيانات كبيرة
  const [
    thisMonthStats,
    lastMonthStats,
    overallStats,
    byStatus,
    byPaymentStatus,
    providersCount,
    usersCount,
    totalBookings,
  ] = await Promise.all([
    // إحصائيات هذا الشهر
    bookingModel.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: "$totalToPay" },
          profit: { $sum: "$totalProfit" },
          collected: { $sum: "$totalPaid" },
        },
      },
    ]),

    // إحصائيات الشهر الماضي
    bookingModel.aggregate([
      {
        $match: { createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: "$totalToPay" },
          profit: { $sum: "$totalProfit" },
        },
      },
    ]),

    // الإجمالي الكلي
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

    // توزيع حسب الحالة
    bookingModel.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // توزيع حسب حالة الدفع
    bookingModel.aggregate([
      { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
    ]),

    providerModel.countDocuments(),
    userModel.countDocuments(),
    bookingModel.countDocuments(),
  ]);

  const tm = thisMonthStats[0] || {
    count: 0,
    revenue: 0,
    profit: 0,
    collected: 0,
  };
  const lm = lastMonthStats[0] || { count: 0, revenue: 0, profit: 0 };
  const ov = overallStats[0] || {
    totalRevenue: 0,
    totalProfit: 0,
    totalCollected: 0,
    totalPending: 0,
  };

  const calcGrowth = (curr, prev) =>
    prev > 0 ? `${(((curr - prev) / prev) * 100).toFixed(1)}%` : "N/A";

  return res.status(200).json({
    success: true,
    message: "Dashboard data retrieved successfully",
    data: {
      thisMonth: {
        bookingsCount: tm.count,
        revenue: tm.revenue,
        profit: tm.profit,
        collected: tm.collected,
        revenueGrowth: calcGrowth(tm.revenue, lm.revenue),
        bookingsGrowth: calcGrowth(tm.count, lm.count),
      },
      lastMonth: {
        bookingsCount: lm.count,
        revenue: lm.revenue,
        profit: lm.profit,
      },
      overall: {
        totalRevenue: ov.totalRevenue,
        totalProfit: ov.totalProfit,
        totalCollected: ov.totalCollected,
        totalPending: ov.totalPending,
      },
      byStatus: Object.fromEntries(byStatus.map((b) => [b._id, b.count])),
      byPaymentStatus: Object.fromEntries(
        byPaymentStatus.map((b) => [b._id, b.count]),
      ),
      counts: { providers: providersCount, users: usersCount, totalBookings },
    },
    errors: null,
  });
});
