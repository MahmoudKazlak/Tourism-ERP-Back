import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Service Voucher — for the provider (hotel / car company / driver)
// Contains service details only — NO sell prices.
// ─────────────────────────────────────────────────────────────────────────────
export const getServiceVoucher = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { serviceType, serviceIndex } = req.query;

  const booking = await bookingModel
    .findById(bookingId)
    .populate("provider", "name phone address")
    .populate("accommodations.hotel", "name phone address")
    .populate("carRentals.provider", "name phone")
    .populate("tripsWithDrivers.provider", "name phone")
    .lean();

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const generateAccommodationVouchers = () =>
    booking.accommodations?.map((acc, i) => ({
      voucherType: "SERVICE_VOUCHER",
      voucherFor: "hotel",
      voucherNumber: `VCH-${booking.bookingID}-ACC-${acc.serviceNumber || i + 1}`,
      issueDate: new Date().toISOString(),
      hotel: {
        name: acc.hotel?.name || "N/A",
        phone: acc.hotel?.phone || "",
        address: acc.hotel?.address || "",
      },
      guests: booking.customers?.map((c) => ({
        name: c.name,
        type: c.ageType || "Adult",
      })),
      checkIn: acc.checkIn,
      checkOut: acc.checkOut,
      duration: acc.duration,
      roomType: acc.roomType,
      room: acc.room,
      board: acc.board,
      totalPax: booking.totalPax,
      notes: "Kindly provide the mentioned services for the above guests.",
    })) || [];

  const generateCarVouchers = () =>
    booking.carRentals?.map((car, i) => ({
      voucherType: "SERVICE_VOUCHER",
      voucherFor: "car_rental",
      voucherNumber: `VCH-${booking.bookingID}-CAR-${car.serviceNumber || i + 1}`,
      issueDate: new Date().toISOString(),
      provider: {
        name: car.provider?.name || "N/A",
        phone: car.provider?.phone || "",
      },
      guests: booking.customers?.map((c) => ({
        name: c.name,
        type: c.ageType,
      })),
      brand: car.brand,
      pickUp: car.pickUp,
      dropOff: car.dropOff,
      totalPax: booking.totalPax,
    })) || [];

  const generateTripVouchers = () =>
    booking.tripsWithDrivers?.map((trip, i) => ({
      voucherType: "SERVICE_VOUCHER",
      voucherFor: "trip_driver",
      voucherNumber: `VCH-${booking.bookingID}-TRIP-${trip.serviceNumber || i + 1}`,
      issueDate: new Date().toISOString(),
      provider: {
        name: trip.provider?.name || "N/A",
        phone: trip.provider?.phone || "",
      },
      guests: booking.customers?.map((c) => ({
        name: c.name,
        type: c.ageType,
      })),
      driverName: trip.driverName,
      brand: trip.brand,
      totalPax: booking.totalPax,
    })) || [];

  let vouchers = [];

  if (!serviceType || serviceType === "accommodations") {
    const v = generateAccommodationVouchers();
    vouchers.push(
      ...(serviceIndex !== undefined ? [v[parseInt(serviceIndex)]] : v),
    );
  }
  if (!serviceType || serviceType === "carRentals") {
    const v = generateCarVouchers();
    vouchers.push(
      ...(serviceIndex !== undefined ? [v[parseInt(serviceIndex)]] : v),
    );
  }
  if (!serviceType || serviceType === "tripsWithDrivers") {
    const v = generateTripVouchers();
    vouchers.push(
      ...(serviceIndex !== undefined ? [v[parseInt(serviceIndex)]] : v),
    );
  }

  vouchers = vouchers.filter(Boolean);

  if (!vouchers.length) {
    return next(
      new Error("No services found for this booking", { cause: 404 }),
    );
  }

  return res.status(200).json({
    success: true,
    message: "Service voucher generated",
    data: {
      bookingID: booking.bookingID,
      issuedBy: booking.createdBy,
      vouchersCount: vouchers.length,
      vouchers,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invoice — customer-facing invoice with sell prices
//
// FIX [9]: When serviceType filter is applied, totals.totalPaid and
// totals.remainingBalance now reflect ONLY the filtered service amount,
// not the entire booking balance. This prevents showing a confusing
// remaining-balance figure that doesn't match the line items on the invoice.
//
// Full booking payment status is still included separately as
// `bookingPaymentStatus` for reference.
// ─────────────────────────────────────────────────────────────────────────────
export const getInvoice = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { serviceType } = req.query;

  const booking = await bookingModel
    .findById(bookingId)
    .populate("provider", "name phone address")
    .populate("accommodations.hotel", "name")
    .populate("carRentals.provider", "name")
    .populate("tripsWithDrivers.provider", "name")
    .populate("createdBy", "userName")
    .lean();

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const payments = await paymentModel
    .find({ booking: booking._id })
    .sort({ date: 1 })
    .lean();

  const lineItems = [];
  let filteredTotal = 0;

  if (!serviceType || serviceType === "accommodations") {
    booking.accommodations?.forEach((acc) => {
      lineItems.push({
        serviceNumber: acc.serviceNumber,
        type: "Hotel Accommodation",
        description: `${acc.hotel?.name || "Hotel"} — ${acc.roomType || ""} / ${acc.board || ""} / ${acc.duration || 0} Nights`,
        checkIn: acc.checkIn,
        checkOut: acc.checkOut,
        amount: acc.sell,
      });
      filteredTotal += Number(acc.sell) || 0;
    });
  }

  if (!serviceType || serviceType === "carRentals") {
    booking.carRentals?.forEach((car) => {
      lineItems.push({
        serviceNumber: car.serviceNumber,
        type: "Car Rental",
        description: `${car.provider?.name || "Provider"} — ${car.brand || ""}`,
        pickUp: car.pickUp,
        dropOff: car.dropOff,
        amount: car.sell,
      });
      filteredTotal += Number(car.sell) || 0;
    });
  }

  if (!serviceType || serviceType === "tripsWithDrivers") {
    booking.tripsWithDrivers?.forEach((trip) => {
      lineItems.push({
        serviceNumber: trip.serviceNumber,
        type: "Trip with Driver",
        description: `${trip.provider?.name || "Provider"} — ${trip.brand || ""} / ${trip.driverName || ""}`,
        amount: trip.sell,
      });
      filteredTotal += Number(trip.sell) || 0;
    });
  }

  const totalPaidForAll = payments.reduce((s, p) => s + p.amount, 0);

  // FIX [9]: For a filtered invoice we cannot attribute specific payments
  // to specific services (payments cover the booking, not a service).
  // So we show the filtered subtotal with a note, rather than showing
  // the full booking's paid/remaining which would be misleading.
  const filteredTotals = serviceType
    ? {
        subtotal: filteredTotal,
        note: "Payment totals below reflect the full booking — individual service payments are not tracked separately.",
        fullBooking: {
          totalToPay: booking.totalToPay,
          totalPaid: booking.totalPaid,
          remainingBalance: booking.remainingBalance,
          paymentStatus: booking.paymentStatus,
        },
      }
    : {
        subtotal: booking.totalToPay,
        totalToPay: booking.totalToPay,
        totalPaid: booking.totalPaid,
        remainingBalance: booking.remainingBalance,
        paymentStatus: booking.paymentStatus,
      };

  const invoice = {
    invoiceType: serviceType
      ? `PARTIAL INVOICE - ${serviceType.toUpperCase()}`
      : "FULL INVOICE",
    invoiceNumber: `INV-${booking.bookingID}-${Date.now().toString().slice(-4)}`,
    issueDate: new Date().toISOString(),
    booking: { id: booking._id, bookingID: booking.bookingID },
    billTo: {
      names: booking.customers?.map((c) => c.name) || [],
      pax: booking.totalPax,
    },
    issuedBy: booking.createdBy?.userName || "N/A",
    lineItems,
    totals: filteredTotals,
    // Payments are shown only on full invoices.
    payments: !serviceType
      ? payments.map((p) => ({
          date: p.date,
          amount: p.amount,
          method: p.method,
        }))
      : [],
  };

  return res.status(200).json({
    success: true,
    message: serviceType
      ? `Partial invoice for ${serviceType} generated`
      : "Full invoice generated",
    data: invoice,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receipt — payment receipt for a single payment
// ─────────────────────────────────────────────────────────────────────────────
export const getReceipt = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel
    .findById(paymentId)
    .populate("recordedBy", "userName")
    .lean();

  if (!payment) return next(new Error("Payment not found", { cause: 404 }));

  const booking = await bookingModel
    .findById(payment.booking)
    .populate("provider", "name")
    .lean();

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const receipt = {
    receiptType: "RECEIPT",
    receiptNumber: `RCP-${booking.bookingID}-${payment._id.toString().slice(-6).toUpperCase()}`,
    issueDate: new Date().toISOString(),
    paymentDate: payment.date,
    receivedFrom: booking.customers?.[0]?.name || "Unknown",
    amount: payment.amount,
    method: payment.method,
    methodLabel:
      {
        cash: "Cash (نقداً)",
        bank_transfer: "Bank Transfer (حوالة بنكية)",
        check: "Check (شيك)",
        other: "Other (أخرى)",
      }[payment.method] || payment.method,
    notes: payment.notes,
    forBooking: {
      bookingID: booking.bookingID,
      provider: booking.provider?.name,
    },
    bookingSummary: {
      totalToPay: booking.totalToPay,
      totalPaid: booking.totalPaid,
      remainingBalance: booking.remainingBalance,
      paymentStatus: booking.paymentStatus,
    },
    recordedBy: payment.recordedBy?.userName || "N/A",
  };

  return res.status(200).json({
    success: true,
    message: "Receipt generated",
    data: receipt,
    errors: null,
  });
});
