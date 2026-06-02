import bookingModel from "../../DB/model/booking.model.js";
import paymentModel from "../../DB/model/payment.model.js";
import {
  SERVICE_TYPES,
  describeService,
} from "../config/serviceTypes.js";

/**
 * Builds structured invoice payload for JSON responses and PDF generation.
 *
 * @param {string} bookingId - MongoDB booking _id
 * @param {{ serviceType?: string }} [options]
 * @returns {Promise<object|null>} Invoice payload, or null when booking is missing
 */
export const buildInvoiceData = async (bookingId, { serviceType } = {}) => {
  const booking = await bookingModel
    .findById(bookingId)
    .populate("provider", "name phone address")
    .populate("services.provider", "name")
    .populate("createdBy", "userName")
    .lean();

  if (!booking) return null;

  const payments = await paymentModel
    .find({ booking: booking._id })
    .populate("providerRecipient", "name")
    .sort({ date: 1 })
    .lean();

  let filteredServices = booking.services || [];
  if (serviceType) {
    filteredServices = filteredServices.filter(
      (s) => s.serviceType === serviceType,
    );
  }

  if (serviceType && filteredServices.length === 0) {
    const err = new Error("No services found matching the filter", {
      cause: 404,
    });
    throw err;
  }

  const lineItems = filteredServices.map((service) => {
    const typeDef = SERVICE_TYPES[service.serviceType];
    return {
      serviceNumber: service.serviceNumber,
      type: typeDef?.label || service.serviceType,
      description: describeService(service),
      duration: service.duration,
      durationUnit: typeDef?.durationFields?.unit,
      amount: service.sell,
      provider: service.provider?.name || "N/A",
    };
  });

  const filteredTotal = filteredServices.reduce(
    (sum, s) => sum + (Number(s.sell) || 0),
    0,
  );

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

  return {
    invoiceType: serviceType
      ? `PARTIAL INVOICE - ${serviceType.toUpperCase()}`
      : "FULL INVOICE",
    invoiceNumber: `INV-${booking.bookingID}-${Date.now().toString().slice(-4)}`,
    issueDate: new Date(),
    booking: {
      id: booking._id,
      bookingID: booking.bookingID,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      provider: booking.provider?.name || "N/A",
    },
    billTo: {
      names: booking.customers?.map((c) => c.name).filter(Boolean) || [],
      pax: booking.totalPax,
    },
    issuedBy: booking.createdBy?.userName || "N/A",
    lineItems,
    totals: filteredTotals,
    payments: !serviceType
      ? payments.map((p) => ({
          date: p.date,
          amount: p.amount,
          method: p.method,
          paidTo: p.providerRecipient?.name || "Office",
        }))
      : [],
  };
};
