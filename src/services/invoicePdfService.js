import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SVGtoPDF from "svg-to-pdfkit";

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

const PAYMENT_METHOD_LABELS = {
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

const truncate = (text, max = 42) => {
  const s = String(text ?? "—");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const getBrandProfile = () => ({
  brandName: process.env.BRAND_NAME || "Kazlak",
  officeName: process.env.COMPANY_NAME || "HayfaTur",
  address: process.env.COMPANY_ADDRESS || "",
  phone: process.env.COMPANY_PHONE || "",
  email: process.env.COMPANY_EMAIL || "",
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

const drawServicesTable = (doc, lineItems, startY, maxEndY) => {
  const left = MARGIN;
  const right = doc.page.width - MARGIN;
  const tableWidth = right - left;
  const columns = [
    { label: "#", width: 22 },
    { label: "Service", width: 88 },
    { label: "Description", width: 200 },
    { label: "Provider", width: 78 },
    { label: "Amount", width: tableWidth - 388 },
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
    fixedText(doc, "No services listed.", left + 4, y + 4);
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
      `+ ${hiddenCount} more service(s) not shown`,
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

const drawTotals = (doc, totals, startY) => {
  const boxWidth = 185;
  const boxLeft = doc.page.width - MARGIN - boxWidth;
  let y = startY;

  const rows = [
    ["Subtotal", formatCurrency(totals.subtotal)],
    [
      "Total Paid",
      formatCurrency(totals.totalPaid ?? totals.fullBooking?.totalPaid),
    ],
    [
      "Balance Due",
      formatCurrency(
        totals.remainingBalance ?? totals.fullBooking?.remainingBalance,
      ),
    ],
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
  fixedText(doc, `Status: ${paymentStatus.toUpperCase()}`, boxLeft, y + 2, {
    font: "Helvetica-Bold",
    fontSize: 7.5,
    fillColor: COLORS.brand,
    width: boxWidth,
    align: "right",
  });

  return y + 16;
};

const drawPaymentsSummary = (doc, payments, startY) => {
  if (!payments?.length) return startY;

  fixedText(doc, "Payments", MARGIN, startY, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });

  let y = startY + 12;
  const maxShown = 2;
  const shown = payments.slice(-maxShown);

  for (const p of shown) {
    const line = `${formatDate(p.date)} • ${PAYMENT_METHOD_LABELS[p.method] || p.method} • ${formatCurrency(p.amount)} → ${truncate(p.paidTo, 18)}`;
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
      `+ ${payments.length - maxShown} earlier payment(s)`,
      MARGIN,
      y,
      { font: "Helvetica-Oblique", fontSize: 6.5, fillColor: COLORS.muted },
    );
    y += 10;
  }

  return y + 2;
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
    `Thank you for choosing ${profile.officeName}. Present this invoice at your provider.`,
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

/** Customer-facing travel agency — clearly separated below app brand. */
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

const drawBrandHeader = (doc, profile, invoiceType) => {
  const brandEndY = drawAppBrandBlock(doc, profile, invoiceType);
  return drawOfficeBlock(doc, profile, brandEndY);
};

export const createInvoicePdfDocument = (invoice) => {
  const profile = getBrandProfile();
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    autoFirstPage: true,
  });

  let y = drawBrandHeader(doc, profile, invoice.invoiceType);

  const colWidth = (doc.page.width - MARGIN * 2 - 20) / 2;
  const rightColX = MARGIN + colWidth + 20;

  const leftEnd = drawMetaBlock(
    doc,
    "Invoice Details",
    [
      ["Invoice No.", invoice.invoiceNumber],
      ["Issue Date", formatDate(invoice.issueDate)],
      ["Issued By", invoice.issuedBy],
    ],
    MARGIN,
    y,
    colWidth,
  );

  const pax = invoice.billTo.pax;
  const rightEnd = drawMetaBlock(
    doc,
    "Bill To",
    [
      ["Customer(s)", invoice.billTo.names.join(", ") || "—"],
      [
        "Passengers",
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

  fixedText(doc, "Booking", MARGIN, y, {
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
  fixedText(doc, "Services", MARGIN, y, {
    font: "Helvetica-Bold",
    fontSize: 8,
    fillColor: COLORS.primary,
  });
  y += 10;

  y = drawServicesTable(doc, invoice.lineItems, y, CONTENT_MAX_Y);
  y = drawTotals(doc, invoice.totals, y);
  drawPaymentsSummary(doc, invoice.payments, Math.min(y + 4, FOOTER_TOP - 40));
  drawFooter(doc, profile);

  return doc;
};

export const generateInvoicePdfBuffer = (invoice) =>
  new Promise((resolve, reject) => {
    const doc = createInvoicePdfDocument(invoice);
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
