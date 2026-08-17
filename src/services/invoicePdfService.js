import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SVGtoPDF from "svg-to-pdfkit";
import { getPdfTranslator, registerPdfFont, PDF_FONTS } from "./pdfDictionary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KAZLAK_MARK_SVG = path.join(__dirname, "../../assets/kazlak-mark.svg");

const MARGIN = 40;
const FOOTER_TOP = 748;
const CONTENT_MAX_Y = 620;

const COLORS = {
  brand: "#1e8c7a",
  brandDark: "#0f4a3e",
  accent: "#e88420",
  primary: "#1e3a5f",
  muted: "#64748b",
  border: "#e2e8f0",
  tableHeader: "#f1f5f9",
};

const methodLabel = (method, t) =>
  t(method) || method;   // dictionary keys match method enum values

const formatCurrency = (value) =>
  `$${(Number(value) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const truncate = (text, max = 42) => {
  const s = String(text ?? "—");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * Builds the brand/office profile used throughout the PDF.
 *
 * Priority order for every field:
 *   1. Value from the OfficeSettings DB document (passed in by the controller)
 *   2. Environment variable fallback
 *   3. Hardcoded default
 *
 * The controller pre-fetches the logo URL into a Buffer (`logoBuffer`) so
 * this function — and the PDF builder it feeds — can stay synchronous.
 *
 * @param {object|null} officeSettings - Lean OfficeSettings document from DB,
 *   optionally extended with a `logoBuffer: Buffer` field by the controller.
 */
const buildProfile = (officeSettings = null) => ({
  brandName:   process.env.BRAND_NAME    || "Kazlak",
  officeName:  officeSettings?.name      || process.env.COMPANY_NAME    || "My Office",
  address:     officeSettings?.address   || process.env.COMPANY_ADDRESS || "",
  phone:       officeSettings?.phone     || process.env.COMPANY_PHONE   || "",
  email:       officeSettings?.email     || process.env.COMPANY_EMAIL   || "",
  // Pre-fetched image buffer from the controller — null when no logo is set
  // or when the fetch failed (PDF generates fine without it).
  logoBuffer:  officeSettings?.logoBuffer ?? null,
});

/** Write text at fixed coordinates without triggering auto page breaks. */
const fixedText = (doc, text, x, y, options = {}) => {
  const {
    font = "Helvetica",
    fontSize = 7,
    fillColor = "#000000",
    ...textOptions
  } = options;

  doc.font(font).fontSize(fontSize).fillColor(fillColor);
  doc.text(String(text), x, y, { lineBreak: false, ...textOptions });
};

const drawMetaBlock = (doc, title, rows, x, y, colWidth) => {
  fixedText(doc, title, x, y, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });

  let rowY = y + 12;
  for (const [label, value] of rows) {
    fixedText(doc, `${label}:`, x, rowY, {
      font: "Helvetica-Bold",
      fontSize: 7.5,
      fillColor: COLORS.muted,
    });
    fixedText(doc, truncate(value, 48), x + 72, rowY, {
      font: "Helvetica",
      fontSize: 7.5,
      fillColor: "#000000",
      width: colWidth - 72,
    });
    rowY += 11;
  }

  return rowY;
};

const drawServicesTable = (doc, lineItems, startY, maxEndY, t) => {
  const left = MARGIN;
  const right = doc.page.width - MARGIN;
  const tableWidth = right - left;
  const columns = [
    { label: t("serviceNo"),   width: 22  },
    { label: t("service"),     width: 88  },
    { label: t("description"), width: 200 },
    { label: t("provider"),    width: 78  },
    { label: t("amount"),      width: tableWidth - 388 },
  ];

  const headerHeight = 16;
  const rowHeight = 15;
  let y = startY;

  doc.save();
  doc.rect(left, y, tableWidth, headerHeight).fill(COLORS.tableHeader);
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLORS.primary);
  let x = left + 4;
  for (const col of columns) {
    fixedText(doc, col.label, x, y + 4, { width: col.width - 6 });
    x += col.width;
  }

  y += headerHeight;
  doc.font("Helvetica").fontSize(7).fillColor("#000000");

  const maxRows = Math.max(
    1,
    Math.floor((maxEndY - y) / rowHeight) - (lineItems.length > 0 ? 1 : 0),
  );
  const visibleItems = lineItems.slice(0, maxRows);
  const hiddenCount = lineItems.length - visibleItems.length;

  if (visibleItems.length === 0) {
    fixedText(doc, t("noServices"), left + 4, y + 4);
    y += rowHeight;
  }

  for (const item of visibleItems) {
    const values = [
      String(item.serviceNumber ?? "—"),
      truncate(item.type, 22),
      truncate(item.description, 38),
      truncate(item.provider, 16),
      formatCurrency(item.amount),
    ];

    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .strokeColor(COLORS.border)
      .lineWidth(0.4)
      .stroke();

    x = left + 4;
    for (let i = 0; i < columns.length; i += 1) {
      fixedText(doc, values[i], x, y + 3, {
        width: columns[i].width - 6,
        align: i === columns.length - 1 ? "right" : "left",
      });
      x += columns[i].width;
    }
    y += rowHeight;
  }

  if (hiddenCount > 0) {
    fixedText(
      doc,
      t("moreServices", { n: hiddenCount }),
      left + 4,
      y + 2,
      { font: "Helvetica-Oblique", fontSize: 6.5, fillColor: COLORS.muted },
    );
    y += 12;
  }

  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.4)
    .stroke();

  return y + 6;
};

const drawTotals = (doc, totals, startY, t) => {
  const boxWidth = 185;
  const boxLeft = doc.page.width - MARGIN - boxWidth;
  let y = startY;

  const rows = [
    [t("subtotal"),   formatCurrency(totals.subtotal)],
    [t("totalPaid"),  formatCurrency(totals.totalPaid ?? totals.fullBooking?.totalPaid)],
    [t("balanceDue"), formatCurrency(
        totals.remainingBalance ?? totals.fullBooking?.remainingBalance,
      )],
  ];

  for (const [label, value] of rows) {
    fixedText(doc, label, boxLeft, y, {
      font: "Helvetica",
      fontSize: 8,
      fillColor: COLORS.muted,
      width: 100,
    });
    fixedText(doc, value, boxLeft + 100, y, {
      font: "Helvetica-Bold",
      fontSize: 8,
      fillColor: "#000000",
      width: 85,
      align: "right",
    });
    y += 12;
  }

  const paymentStatus =
    totals.paymentStatus ?? totals.fullBooking?.paymentStatus ?? "unpaid";
  fixedText(doc, `${t("paymentStatusLbl")}: ${paymentStatus.toUpperCase()}`, boxLeft, y + 2, {
    font: "Helvetica-Bold",
    fontSize: 7.5,
    fillColor: COLORS.brand,
    width: boxWidth,
    align: "right",
  });

  return y + 16;
};

const drawPaymentsSummary = (doc, payments, startY, t) => {
  if (!payments?.length) return startY;

  fixedText(doc, t("payments"), MARGIN, startY, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });

  let y = startY + 12;
  const maxShown = 2;
  const shown = payments.slice(-maxShown);

  for (const p of shown) {
    const line = `${formatDate(p.date)} • ${methodLabel(p.method, t)} • ${formatCurrency(p.amount)} → ${truncate(p.paidTo, 18)}`;
    fixedText(doc, line, MARGIN, y, {
      font: "Helvetica",
      fontSize: 7,
      fillColor: "#000000",
    });
    y += 10;
  }

  if (payments.length > maxShown) {
    fixedText(
      doc,
      t("morePayments", { n: payments.length - maxShown }),
      MARGIN,
      y,
      { font: "Helvetica-Oblique", fontSize: 6.5, fillColor: COLORS.muted },
    );
    y += 10;
  }

  return y + 2;
};

const drawFooter = (doc, profile, t) => {
  doc
    .moveTo(MARGIN, FOOTER_TOP)
    .lineTo(doc.page.width - MARGIN, FOOTER_TOP)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();

  fixedText(
    doc,
    t("thankYouInvoice", { office: profile.officeName }),
    MARGIN,
    FOOTER_TOP + 10,
    {
      font: "Helvetica",
      fontSize: 7.5,
      fillColor: COLORS.muted,
      width: doc.page.width - MARGIN * 2,
      align: "center",
    },
  );

  fixedText(
    doc,
    t("poweredBy", { brand: profile.brandName }),
    MARGIN,
    FOOTER_TOP + 24,
    {
      font: "Helvetica",
      fontSize: 6.5,
      fillColor: COLORS.muted,
      width: doc.page.width - MARGIN * 2,
      align: "center",
    },
  );
};

/** App branding only — logo + Kazlak + tagline (not the customer-facing office). */
const drawAppBrandBlock = (doc, profile, invoiceType) => {
  const blockLeft = MARGIN;
  const markSize = 38;
  let y = 36;

  if (fs.existsSync(KAZLAK_MARK_SVG)) {
    const svg = fs.readFileSync(KAZLAK_MARK_SVG, "utf8");
    SVGtoPDF(doc, svg, blockLeft, y, {
      width: markSize,
      height: markSize,
      preserveAspectRatio: "xMidYMid meet",
    });
    y += markSize + 10;
  }

  fixedText(doc, profile.brandName, blockLeft, y, {
    font: "Helvetica-Bold",
    fontSize: 15,
    fillColor: COLORS.brand,
  });
  y += 17;

  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(COLORS.muted);
  const bookingW = doc.widthOfString("BOOKING ");
  doc.text("BOOKING ", blockLeft, y, { lineBreak: false });
  doc.fillColor(COLORS.accent);
  const erpW = doc.widthOfString("ERP ");
  doc.text("ERP ", blockLeft + bookingW, y, { lineBreak: false });
  doc.fillColor(COLORS.muted);
  doc.text("SOLUTIONS", blockLeft + bookingW + erpW, y, { lineBreak: false });
  y += 14;

  const rightX = doc.page.width - MARGIN - 150;
  fixedText(doc, "INVOICE", rightX, 40, {
    font: "Helvetica-Bold",
    fontSize: 22,
    fillColor: COLORS.primary,
    width: 150,
    align: "right",
  });

  fixedText(doc, invoiceType, rightX, 66, {
    font: "Helvetica",
    fontSize: 7.5,
    fillColor: COLORS.muted,
    width: 150,
    align: "right",
  });

  return y;
};

/**
 * Customer-facing travel agency block — clearly separated below app brand.
 * Renders the office logo (if a buffer was pre-fetched) then name/contact.
 */
const drawOfficeBlock = (doc, profile, startY, t) => {
  let y = startY + 6;

  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();

  y += 12;

  fixedText(doc, t("agency"), MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 6.5,
    fillColor: COLORS.muted,
  });
  y += 11;

  // ── Office logo (optional) ─────────────────────────────────────────────────
  // The buffer was pre-fetched from Cloudinary by the controller before the
  // synchronous PDF pipeline started. Skip silently if unavailable.
  if (profile.logoBuffer) {
    try {
      doc.image(profile.logoBuffer, MARGIN, y, { height: 28, fit: [80, 28] });
      y += 36;
    } catch (_) {
      // Invalid or unsupported image — continue without it
    }
  }

  fixedText(doc, profile.officeName, MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 11,
    fillColor: COLORS.primary,
  });
  y += 14;

  const contact = [profile.phone, profile.email].filter(Boolean).join(" • ");
  if (contact) {
    fixedText(doc, contact, MARGIN, y, {
      font: "Helvetica",
      fontSize: 7.5,
      fillColor: COLORS.muted,
      width: 280,
    });
    y += 11;
  }

  if (profile.address) {
    fixedText(doc, profile.address, MARGIN, y, {
      font: "Helvetica",
      fontSize: 7.5,
      fillColor: COLORS.muted,
      width: 280,
    });
    y += 11;
  }

  y += 4;
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.8)
    .stroke();

  return y + 10;
};

const drawBrandHeader = (doc, profile, invoiceType, t) => {
  const brandEndY = drawAppBrandBlock(doc, profile, invoiceType);
  return drawOfficeBlock(doc, profile, brandEndY, t);
};

/**
 * Builds a PDFKit document for an invoice.
 *
 * @param {object} invoice - Invoice data object from buildInvoiceData()
 * @param {object|null} officeSettings - Lean OfficeSettings document from DB,
 *   optionally extended with `logoBuffer: Buffer` by the controller.
 *   Pass null to fall back to env-var defaults.
 */
export const createInvoicePdfDocument = (invoice, officeSettings = null) => {
  const profile = buildProfile(officeSettings);
  const t = getPdfTranslator(officeSettings?.pdfLanguage);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    autoFirstPage: true,
  });
  registerPdfFont(doc);

  let y = drawBrandHeader(doc, profile, invoice.invoiceType, t);

  const colWidth = (doc.page.width - MARGIN * 2 - 20) / 2;
  const rightColX = MARGIN + colWidth + 20;

  const leftEnd = drawMetaBlock(
    doc,
    t("invoiceDetails"),
    [
      [t("invoiceNo"),  invoice.invoiceNumber],
      [t("issueDate"),  formatDate(invoice.issueDate)],
      [t("issuedBy"),   invoice.issuedBy],
    ],
    MARGIN,
    y,
    colWidth,
  );

  const pax = invoice.billTo.pax;
  const rightEnd = drawMetaBlock(
    doc,
    t("billTo"),
    [
      [t("customers"),  invoice.billTo.names.join(", ") || "—"],
      [
        t("passengers"),
        pax
          ? `${pax.adults ?? 0}A / ${pax.kids ?? 0}C (${pax.total ?? 0} total)`
          : "—",
      ],
    ],
    rightColX,
    y,
    colWidth,
  );

  y = Math.max(leftEnd, rightEnd) + 4;

  fixedText(doc, t("booking"), MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });

  y += 12;
  fixedText(
    doc,
    [
      `#${invoice.booking.bookingID}`,
      invoice.booking.status,
      invoice.booking.provider,
      formatDate(invoice.booking.createdAt),
    ].join(" • "),
    MARGIN,
    y,
    { font: "Helvetica", fontSize: 7.5, fillColor: "#000000" },
  );

  y += 16;
  fixedText(doc, t("services"), MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });
  y += 10;

  y = drawServicesTable(doc, invoice.lineItems, y, CONTENT_MAX_Y, t);
  y = drawTotals(doc, invoice.totals, y, t);
  drawPaymentsSummary(doc, invoice.payments, Math.min(y + 4, FOOTER_TOP - 40), t);
  drawFooter(doc, profile, t);

  return doc;
};

export const generateInvoicePdfBuffer = (invoice, officeSettings = null) =>
  new Promise((resolve, reject) => {
    const doc = createInvoicePdfDocument(invoice, officeSettings);
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
