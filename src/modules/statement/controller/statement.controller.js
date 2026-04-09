import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import providerModel from "../../../../DB/model/provider.model.js";

// ─────────────────────────────────────────────
// كشف حساب مورد
// المنطق: ما اشتريناه منه (buy) مقابل ما دفعناه له (payments للحجوزات)
// ─────────────────────────────────────────────
export const getProviderStatement = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { fromDate, toDate } = req.query;

  const provider = await providerModel.findById(providerId);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  // بناء فلتر التاريخ
  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    dateFilter.$lte = to;
  }

  // جلب كل الحجوزات المرتبطة بهاد المورد
  const bookingQuery = {
    $or: [
      { provider: providerId },
      { "accommodations.hotel": providerId },
      { "carRentals.provider": providerId },
      { "tripsWithDrivers.provider": providerId },
    ],
  };
  if (Object.keys(dateFilter).length) bookingQuery.createdAt = dateFilter;

  const bookings = await bookingModel
    .find(bookingQuery)
    .populate(
      "accommodations.hotel carRentals.provider tripsWithDrivers.provider",
    )
    .lean();

  // ─── استخراج الخدمات المرتبطة بهاد المورد فقط ───
  const serviceLines = [];
  let totalOwedToProvider = 0; // إجمالي ما اشتريناه منه (buy)

  bookings.forEach((booking) => {
    const addLines = (items, serviceType, providerKey, getLabel) => {
      items?.forEach((item) => {
        const pid =
          item[providerKey]?._id?.toString() || item[providerKey]?.toString();
        if (pid !== providerId) return;

        const buy = Number(item.buy) || 0;
        totalOwedToProvider += buy;

        serviceLines.push({
          bookingID: booking.bookingID,
          bookingMongoId: booking._id,
          customer: booking.customers?.[0]?.name || "Unknown",
          date: booking.createdAt,
          serviceType,
          label: getLabel(item),
          amount: buy, // ما بدنا ندفعه للمورد
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

  // ─── الدفعات اللي صرفناها بالفعل لهالمورد ───
  // ملاحظة: الدفعات الحالية هي من الزبون للشركة، ليس من الشركة للمورد.
  // هون بنعرض ما يستحقه المورد وما تم صرفه (لو عندك payment للمورد بالمستقبل)
  // حالياً: نعرض ما هو مستحق فقط
  const summary = {
    totalOwedToProvider, // ما بدك تدفعه للمورد (buy total)
    totalPaid: 0, // ما دفعته فعلاً (للتطوير المستقبلي)
    netBalance: totalOwedToProvider, // الرصيد المتبقي للمورد
    balanceLabel:
      totalOwedToProvider > 0
        ? `المورد له ${totalOwedToProvider} عندك`
        : `المورد مدين لك بـ ${Math.abs(totalOwedToProvider)}`,
  };

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
        ...summary,
      },
      lines: serviceLines.sort((a, b) => new Date(a.date) - new Date(b.date)),
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────
// كشف حساب زبون
// البحث بالاسم عبر كل الحجوزات (لأنه مش موجود كـ entity مستقل)
// ─────────────────────────────────────────────
export const getCustomerStatement = asyncHandler(async (req, res, next) => {
  const { customerName } = req.params;
  const { fromDate, toDate } = req.query;

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

  const bookings = await bookingModel
    .find(bookingQuery)
    .populate("provider", "name type")
    .lean();

  if (!bookings.length) {
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

  // جلب كل الدفعات لهاي الحجوزات دفعة وحدة
  const bookingIds = bookings.map((b) => b._id);
  const payments = await paymentModel
    .find({ booking: { $in: bookingIds } })
    .lean();

  // تجميع الدفعات حسب الحجز
  const paymentsByBooking = {};
  payments.forEach((p) => {
    const key = p.booking.toString();
    if (!paymentsByBooking[key]) paymentsByBooking[key] = [];
    paymentsByBooking[key].push(p);
  });

  // بناء التفاصيل
  let totalToPay = 0;
  let totalPaid = 0;

  const bookingLines = bookings.map((b) => {
    const bPayments = paymentsByBooking[b._id.toString()] || [];
    const paidForThis = bPayments.reduce((s, p) => s + p.amount, 0);

    totalToPay += b.totalToPay || 0;
    totalPaid += paidForThis;

    // الزبون المطابق تحديداً
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
        totalBookings: bookings.length,
        totalToPay,
        totalPaid,
        remainingBalance: totalToPay - totalPaid,
        balanceLabel:
          totalToPay - totalPaid > 0
            ? `الزبون مدين بـ ${totalToPay - totalPaid}`
            : "الحساب صافي",
      },
      bookings: bookingLines.sort(
        (a, b) => new Date(a.date) - new Date(b.date),
      ),
    },
    errors: null,
  });
});
