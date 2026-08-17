import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import { describeService } from "../../../config/serviceTypes.js";
import { getMergedServiceTypes } from "../../../services/serviceTypeRegistry.js";
import { buildInvoiceData } from "../../../services/invoiceService.js";
import { createInvoicePdfDocument } from "../../../services/invoicePdfService.js";
import { generateVoucherPdfBuffer } from "../../../services/voucherPdfService.js";
import officeSettingsModel from "../../../../DB/model/officeSettings.model.js";

export const getServiceVoucher = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { serviceType, serviceIndex } = req.query;

  const booking = await bookingModel
    .findById(bookingId)
    .populate("provider", "name phone address")
    .populate("services.provider", "name phone address")
    .lean();

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  let services = booking.services || [];

  // Filter by serviceType if provided
  if (serviceType) {
    services = services.filter((s) => s.serviceType === serviceType);
  }

  // Filter to a specific index if provided
  if (serviceIndex !== undefined) {
    const idx = parseInt(serviceIndex);
    services = services[idx] ? [services[idx]] : [];
  }

  if (!services.length) {
    return next(
      new Error("No services found matching the filter", { cause: 404 }),
    );
  }

  const vouchers = services.map((service) => {
    const typeDef = getMergedServiceTypes()[service.serviceType];
    return {
      voucherType: "SERVICE_VOUCHER",
      voucherFor: service.serviceType,
      voucherLabel: typeDef?.label || service.serviceType,
      voucherNumber: `VCH-${booking.bookingID}-${typeDef?.voucherPrefix || "SRV"}-${service.serviceNumber}`,
      issueDate: new Date().toISOString(),
      provider: {
        name: service.provider?.name || "N/A",
        phone: service.provider?.phone || "",
        address: service.provider?.address || "",
      },
      guests: booking.customers?.map((c) => ({
        name: c.name,
        type: c.ageType || "Adult",
      })),
      totalPax: booking.totalPax,
      duration: service.duration,
      durationUnit: typeDef?.durationFields?.unit,
      description: describeService(service),
      // All type-specific fields are available under details for frontend rendering
      details: service.details || {},
      notes: "Kindly provide the mentioned services for the above guests.",
    };
  });

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

export const getInvoice = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { serviceType } = req.query;

  const invoice = await buildInvoiceData(bookingId, { serviceType });
  if (!invoice) return next(new Error("Booking not found", { cause: 404 }));

  return res.status(200).json({
    success: true,
    message: serviceType
      ? `Partial invoice for ${serviceType} generated`
      : "Full invoice generated",
    data: {
      ...invoice,
      issueDate: invoice.issueDate.toISOString(),
    },
    errors: null,
  });
});

export const downloadInvoicePdf = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { serviceType } = req.query;

  // Fetch invoice data and office settings in parallel
  const [invoice, officeSettings] = await Promise.all([
    buildInvoiceData(bookingId, { serviceType }),
    officeSettingsModel.findOne().lean(),
  ]);

  if (!invoice) return next(new Error("Booking not found", { cause: 404 }));

  // Pre-fetch the office logo so the synchronous PDF builder can embed it.
  // Uses the built-in fetch (Node 18+). Failure is non-critical — the PDF
  // generates normally without a logo if the fetch times out or fails.
  let logoBuffer = null;
  if (officeSettings?.logoUrl) {
    try {
      const response = await fetch(officeSettings.logoUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        logoBuffer = Buffer.from(arrayBuffer);
      }
    } catch (e) {
      console.warn("⚠️  Could not fetch office logo for PDF:", e.message);
    }
  }

  const filename = `${invoice.invoiceNumber}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");

  // Pass the DB settings + pre-fetched logo buffer into the PDF builder.
  // The builder remains synchronous — no async inside PDFKit callbacks.
  const doc = createInvoicePdfDocument(invoice, {
    ...officeSettings,
    logoBuffer,
  });
  doc.on("error", (err) => next(err));
  doc.pipe(res);
  doc.end();
});

export const getReceipt = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await paymentModel
    .findById(paymentId)
    .populate("recordedBy", "userName")
    .populate("providerRecipient", "name")
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
    receivedBy: payment.providerRecipient?.name || "Office",
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

// NEW — add at end of file, before final blank line
/**
 * Streams a PDFKit-based provider voucher for a booking.
 * Matches the "HOTEL RESERVATION FORM" layout shown in the product spec.
 *
 * GET /api/v1/voucher/service/:bookingId/pdf?serviceType=accommodation
 *
 * @query serviceType {string}  Optional — filter to a specific service type only.
 */
export const downloadServiceVoucherPdf = asyncHandler(
  async (req, res, next) => {
    const { bookingId } = req.params;
    const { serviceType } = req.query;

    const [booking, officeSettings] = await Promise.all([
      bookingModel
        .findById(bookingId)
        .populate("provider", "name phone address")
        .populate("services.provider", "name phone address")
        .populate("createdBy", "userName")
        .lean(),
      officeSettingsModel.findOne().lean(),
    ]);

    if (!booking) return next(new Error("Booking not found", { cause: 404 }));

    // Pre-fetch office logo (non-critical — PDF generates fine without it)
    let logoBuffer = null;
    if (officeSettings?.logoUrl) {
      try {
        const r = await fetch(officeSettings.logoUrl);
        if (r.ok) logoBuffer = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        console.warn(
          "⚠️  Could not fetch office logo for voucher PDF:",
          e.message,
        );
      }
    }

    const buffer = await generateVoucherPdfBuffer(
      booking,
      { ...officeSettings, logoBuffer },
      serviceType || null,
    );

    const filename = `voucher-${pad4(booking.bookingID)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  },
);

// helper — local to this controller, not exported
function pad4(n) {
  return String(n ?? 0).padStart(4, "0");
}
