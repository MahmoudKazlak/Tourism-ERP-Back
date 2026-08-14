/**
 * PDFKit-based receipt generator for Payment, ProviderPayment, and
 * ProviderCollection records.
 *
 * Mirrors the visual style of invoicePdfService.js (same brand colours,
 * header, footer, font stack) but produces a compact single-page receipt
 * instead of a multi-section invoice with a services table.
 *
 * Helper functions (fixedText, buildProfile, drawBrandHeader, drawFooter, …)
 * are intentionally duplicated from invoicePdfService.js rather than shared
 * via an intermediate module, to keep invoicePdfService.js untouched and
 * respect the project's regression-avoidance rule.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SVGtoPDF from "svg-to-pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KAZLAK_MARK_SVG = path.join(__dirname, "../../assets/kazlak-mark.svg");

const MARGIN = 40;
const FOOTER_TOP = 748;

const COLORS = {
  brand: "#1e8c7a",
  accent: "#e88420",
  primary: "#1e3a5f",
  muted: "#64748b",
  border: "#e2e8f0",
  tableHeader: "#f1f5f9",
};

export const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  check: "Check",
  other: "Other",
};

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

const buildProfile = (officeSettings = null) => ({
  brandName: process.env.BRAND_NAME || "Kazlak",
  officeName: officeSettings?.name || process.env.COMPANY_NAME || "My Office",
  address: officeSettings?.address || process.env.COMPANY_ADDRESS || "",
  phone: officeSettings?.phone || process.env.COMPANY_PHONE || "",
  email: officeSettings?.email || process.env.COMPANY_EMAIL || "",
  logoBuffer: officeSettings?.logoBuffer ?? null,
});

const fixedText = (doc, text, x, y, options = {}) => {
  const {
    font = "Helvetica",
    fontSize = 7,
    fillColor = "#000000",
    ...rest
  } = options;
  doc.font(font).fontSize(fontSize).fillColor(fillColor);
  doc.text(String(text ?? "—"), x, y, { lineBreak: false, ...rest });
};

const drawAppBrandBlock = (doc, profile, receiptType) => {
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
  fixedText(doc, "RECEIPT", rightX, 40, {
    font: "Helvetica-Bold",
    fontSize: 22,
    fillColor: COLORS.primary,
    width: 150,
    align: "right",
  });
  fixedText(doc, receiptType, rightX, 66, {
    font: "Helvetica",
    fontSize: 7.5,
    fillColor: COLORS.muted,
    width: 150,
    align: "right",
  });

  return y;
};

const drawOfficeBlock = (doc, profile, startY) => {
  let y = startY + 6;

  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();
  y += 12;

  fixedText(doc, "AGENCY", MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 6.5,
    fillColor: COLORS.muted,
  });
  y += 11;

  if (profile.logoBuffer) {
    try {
      doc.image(profile.logoBuffer, MARGIN, y, { height: 28, fit: [80, 28] });
      y += 36;
    } catch (_) {}
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

const drawBrandHeader = (doc, profile, receiptType) => {
  const brandEndY = drawAppBrandBlock(doc, profile, receiptType);
  return drawOfficeBlock(doc, profile, brandEndY);
};

const drawFooter = (doc, profile) => {
  doc
    .moveTo(MARGIN, FOOTER_TOP)
    .lineTo(doc.page.width - MARGIN, FOOTER_TOP)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();

  fixedText(
    doc,
    `Thank you for choosing ${profile.officeName}. Keep this receipt for your records.`,
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
    `Powered by ${profile.brandName} Booking ERP`,
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

/**
 * Builds the PDFKit document for a receipt.
 *
 * @param {object} receipt
 *   - receiptType  {string}  "PAYMENT RECEIPT" | "PROVIDER PAYMENT" | "PROVIDER COLLECTION"
 *   - receiptNumber {string} e.g. "REC-64a8b3f2"
 *   - issueDate    {Date}
 *   - amount       {number}
 *   - method       {string}  payment method key
 *   - date         {Date}    transaction date
 *   - reference    {string|null}
 *   - notes        {string|null}
 *   - booking      {object|null}  { bookingID, referenceCode }
 *   - entity       {object}  { label: string, name: string }
 *     e.g. { label: "Customer", name: "Ahmed Saeed" }
 *     or   { label: "Provider", name: "Hilton Hotel" }
 *   - recordedBy   {string}
 * @param {object|null} officeSettings
 */
export const createReceiptPdfDocument = (receipt, officeSettings = null) => {
  const profile = buildProfile(officeSettings);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    autoFirstPage: true,
  });

  let y = drawBrandHeader(doc, profile, receipt.receiptType);

  // ── Amount block (prominent) ───────────────────────────────────────────────
  fixedText(doc, "AMOUNT", MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.muted,
  });
  y += 12;

  fixedText(doc, formatCurrency(receipt.amount), MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 26,
    fillColor: COLORS.primary,
  });
  y += 34;

  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();
  y += 14;

  // ── Details table ──────────────────────────────────────────────────────────
  const labelX = MARGIN;
  const valueX = MARGIN + 130;
  const rowH = 16;
  const valueW = doc.page.width - MARGIN - valueX;

  const detailRow = (label, value) => {
    if (!value || value === "—") return;
    fixedText(doc, label, labelX, y, {
      font: "Helvetica-Bold",
      fontSize: 8,
      fillColor: COLORS.muted,
    });
    fixedText(doc, String(value), valueX, y, {
      font: "Helvetica",
      fontSize: 8,
      fillColor: "#1a1a2e",
      width: valueW,
    });
    y += rowH;
  };

  detailRow("Receipt No.", receipt.receiptNumber);
  detailRow("Issue Date", formatDate(receipt.issueDate));
  detailRow("Transaction Date", formatDate(receipt.date));
  detailRow("Method", PAYMENT_METHOD_LABELS[receipt.method] || receipt.method);
  detailRow(receipt.entity.label, receipt.entity.name);

  if (receipt.booking?.bookingID) {
    const bookingRef = receipt.booking.referenceCode
      ? `#${receipt.booking.bookingID} · ${receipt.booking.referenceCode}`
      : `#${receipt.booking.bookingID}`;
    detailRow("Booking", bookingRef);
  }

  if (receipt.reference) detailRow("Reference", receipt.reference);
  if (receipt.notes) detailRow("Notes", receipt.notes);

  detailRow("Recorded By", receipt.recordedBy);

  // ── Bottom rule ────────────────────────────────────────────────────────────
  y += 6;
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .stroke();

  drawFooter(doc, profile);

  return doc;
};

export const generateReceiptPdfBuffer = (receipt, officeSettings = null) =>
  new Promise((resolve, reject) => {
    const doc = createReceiptPdfDocument(receipt, officeSettings);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
