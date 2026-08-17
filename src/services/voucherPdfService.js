/**
 * PDFKit-based Service Voucher PDF generator.
 *
 * Produces a "HOTEL RESERVATION FORM"-style provider voucher matching the
 * layout shown in the product specification image. The document is intended
 * to be handed to the service provider (hotel, car company, etc.) to confirm
 * the reservation details without exposing pricing.
 *
 * Helper functions are intentionally self-contained (no imports from
 * invoicePdfService.js) to respect the regression-avoidance rule.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SVGtoPDF from "svg-to-pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_SVG = path.join(__dirname, "../../assets/kazlak-mark.svg");

const MARGIN = 40;
const PAGE_W = 595; // A4 portrait
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Formatting helpers ────────────────────────────────────────────────────────

const pad4 = (n) => String(n ?? 0).padStart(4, "0");

const fmtDate = (v) => {
  if (!v) return "—";
  return new Date(v)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "/"); // DD/MM/YYYY
};

const fmtDateTime = (v) => {
  const d = v ? new Date(v) : new Date();
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return { date, time };
};

const capFirst = (s) =>
  s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";

const guestTitle = (ageType) => {
  if (!ageType) return "";
  switch (ageType.toLowerCase()) {
    case "adult":
      return "Mr/Ms";
    case "child":
      return "Mstr";
    case "infant":
      return "Inf";
    default:
      return capFirst(ageType);
  }
};

// ── Low-level draw helpers ────────────────────────────────────────────────────

const tx = (doc, text, x, y, opts = {}) => {
  const {
    font = "Helvetica",
    size = 7.5,
    color = "#000000",
    width,
    align,
    lineBreak = false,
  } = opts;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ""), x, y, {
    lineBreak,
    ...(width ? { width } : {}),
    ...(align ? { align } : {}),
  });
};

const hLine = (
  doc,
  y,
  x1 = MARGIN,
  x2 = PAGE_W - MARGIN,
  weight = 0.5,
  color = "#cccccc",
) => {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(weight).stroke();
};

const vLine = (doc, x, y1, y2, weight = 0.5, color = "#cccccc") => {
  doc.moveTo(x, y1).lineTo(x, y2).strokeColor(color).lineWidth(weight).stroke();
};

const rect = (doc, x, y, w, h, strokeColor = "#cccccc", weight = 0.5) => {
  doc.rect(x, y, w, h).strokeColor(strokeColor).lineWidth(weight).stroke();
};

// ── Document title based on dominant service type ─────────────────────────────

const docTitle = (services) => {
  const types = [...new Set(services.map((s) => s.serviceType))];
  if (types.length === 1) {
    switch (types[0]) {
      case "accommodation":
        return "HOTEL RESERVATION FORM";
      case "apartRent":
        return "APARTMENT RESERVATION FORM";
      case "carRental":
        return "CAR RENTAL VOUCHER";
      case "carWithDriver":
        return "TRANSPORTATION VOUCHER";
      case "trip":
        return "EXCURSION VOUCHER";
      default:
        return "SERVICE VOUCHER";
    }
  }
  return "BOOKING VOUCHER";
};

// ── Header ────────────────────────────────────────────────────────────────────

const drawHeader = (doc, profile, services, booking) => {
  const now = fmtDateTime();
  let y = MARGIN;

  // Outer border for the header block
  const headerH = 100;
  rect(doc, MARGIN, y, CONTENT_W, headerH, "#999999", 0.6);

  // Left column — logo + company name block
  let logoEndY = y + 8;
  const logoSize = 36;
  if (fs.existsSync(LOGO_SVG)) {
    try {
      const svg = fs.readFileSync(LOGO_SVG, "utf8");
      SVGtoPDF(doc, svg, MARGIN + 6, y + 8, {
        width: logoSize,
        height: logoSize,
        preserveAspectRatio: "xMidYMid meet",
      });
      logoEndY = y + 8 + logoSize + 4;
    } catch (_) {}
  } else if (profile.logoBuffer) {
    try {
      doc.image(profile.logoBuffer, MARGIN + 6, y + 8, {
        height: logoSize,
        fit: [60, logoSize],
      });
      logoEndY = y + 8 + logoSize + 4;
    } catch (_) {}
  }

  // Center column — company + document type + hotel + city
  const centerX = MARGIN + 80;
  const centerW = CONTENT_W - 80 - 100;
  let cy = y + 10;

  tx(doc, profile.officeName, centerX, cy, {
    font: "Helvetica-BoldOblique",
    size: 11,
    width: centerW,
    align: "center",
  });
  cy += 14;
  tx(doc, docTitle(services), centerX, cy, {
    font: "Helvetica-BoldOblique",
    size: 9,
    width: centerW,
    align: "center",
  });
  cy += 12;
  // Provider (hotel) name — first accommodation service provider
  const accomService = services.find((s) =>
    ["accommodation", "apartRent"].includes(s.serviceType),
  );
  const hotelName =
    accomService?.provider?.name ?? services[0]?.provider?.name ?? "";
  if (hotelName) {
    tx(doc, hotelName.toUpperCase(), centerX, cy, {
      font: "Helvetica-Bold",
      size: 9,
      width: centerW,
      align: "center",
      color: "#222222",
    });
    cy += 12;
  }
  // City from provider address (first word/line) or booking notes
  const city = (
    accomService?.provider?.address ??
    services[0]?.provider?.address ??
    ""
  )
    .split(/[\n,]/)[0]
    .trim();
  if (city) {
    tx(doc, city.toUpperCase(), centerX, cy, {
      font: "Helvetica-Bold",
      size: 9,
      width: centerW,
      align: "center",
    });
  }

  // Right column — date / time / page
  const rightX = PAGE_W - MARGIN - 95;
  let ry = y + 12;
  tx(doc, `Date : ${now.date}`, rightX, ry, { size: 7, width: 90 });
  ry += 11;
  tx(doc, `Time : ${now.time}`, rightX, ry, { size: 7, width: 90 });
  ry += 11;
  tx(doc, `Page : 1`, rightX, ry, { size: 7, width: 90 });

  return y + headerH;
};

// ── Voucher number + status row ───────────────────────────────────────────────

const drawVoucherRow = (doc, booking, startY) => {
  const y = startY + 8;
  const voucherNo = `Voucher No: ${pad4(booking.bookingID)}`;
  tx(doc, voucherNo, MARGIN + 4, y, { font: "Helvetica-Bold", size: 10 });

  // Status label — centred
  const status = (booking.status ?? "new").toUpperCase();
  tx(doc, status, MARGIN, y - 2, {
    font: "Helvetica-Bold",
    size: 18,
    color: "#111111",
    width: CONTENT_W,
    align: "center",
  });

  hLine(doc, startY + 26, MARGIN, PAGE_W - MARGIN, 0.7, "#888888");
  return startY + 30;
};

// ── Service block (one per service) ──────────────────────────────────────────

/**
 * Draws a numbered service block.
 * Mirrors the 3-column layout in the image:
 *   Col A (dates/stay)  |  Col B (room/service details)  |  Col C (pax)
 */
const drawServiceBlock = (doc, service, idx, booking, startY) => {
  const d = service.details || {};
  const typeDef = service._typeDef || {};
  const isHotel = ["accommodation", "apartRent"].includes(service.serviceType);
  const isCarR = ["carRental", "carWithDriver"].includes(service.serviceType);

  let y = startY + 6;

  // Row number
  tx(doc, `${idx + 1}.`, MARGIN + 2, y, { font: "Helvetica-Bold", size: 8 });

  const col = {
    a: { x: MARGIN + 18, w: 145 },
    b: { x: MARGIN + 168, w: 195 },
    c: { x: MARGIN + 368, w: CONTENT_W - 368 },
  };

  const LH = 11; // line height within block
  let ay = y;
  let by = y;
  let cy = y;

  // ── Column A: dates & stay info ───────────────────────────────────────────
  if (isHotel) {
    const colARows = [
      ["C/In Date", fmtDate(d.checkIn)],
      ["C/Out Date", fmtDate(d.checkOut)],
      ["Day", service.duration != null ? String(service.duration) : "—"],
      [
        "Sejour Card Nr",
        service.serviceNumber != null ? String(service.serviceNumber) : "—",
      ],
    ];
    for (const [label, value] of colARows) {
      tx(doc, `${label} :`, col.a.x, ay, { font: "Helvetica-Bold", size: 7 });
      tx(doc, value, col.a.x + 70, ay, {
        size: 7,
        font: "Helvetica-Bold",
        color: "#111111",
      });
      ay += LH;
    }
  } else if (isCarR) {
    const colARows = [
      ["Pick-up Date", fmtDate(d.pickUp || d.from)],
      ["Drop-off Date", fmtDate(d.dropOff || d.to)],
      ["Duration", service.duration != null ? `${service.duration} days` : "—"],
    ];
    for (const [label, value] of colARows) {
      tx(doc, `${label} :`, col.a.x, ay, { font: "Helvetica-Bold", size: 7 });
      tx(doc, value, col.a.x + 72, ay, { size: 7, font: "Helvetica-Bold" });
      ay += LH;
    }
  } else {
    const date = d.date || d.from || d.startDate;
    if (date) {
      tx(doc, "Date :", col.a.x, ay, { font: "Helvetica-Bold", size: 7 });
      tx(doc, fmtDate(date), col.a.x + 38, ay, { size: 7 });
      ay += LH;
    }
    if (service.duration != null) {
      tx(doc, "Duration :", col.a.x, ay, { font: "Helvetica-Bold", size: 7 });
      tx(doc, `${service.duration} days`, col.a.x + 52, ay, { size: 7 });
      ay += LH;
    }
  }

  // ── Column B: room/service details ───────────────────────────────────────
  if (isHotel) {
    const roomCount = d.roomCount ?? d.rooms ?? 1;
    const roomView = d.roomView ?? d.view ?? "";
    const roomType = d.roomType ?? "";
    const board = d.board ?? "";
    const status = d.status ?? "Ok";

    const colBRows = [
      ["Room Count", String(roomCount)],
      ["Room", roomView || "—"],
      ["Room Type", roomType || "—"],
      ["Board", board || "—"],
      ["Status", status],
    ];
    for (const [label, value] of colBRows) {
      tx(doc, `${label} :`, col.b.x, by, { font: "Helvetica-Bold", size: 7 });
      tx(
        doc,
        value.toString().toUpperCase().slice(0, 3) || value,
        col.b.x + 68,
        by,
        { size: 7, font: "Helvetica-Bold" },
      );
      by += LH;
    }

    // Descriptive lines below the grid (parenthetical, like in the image)
    by += 3;
    if (roomView) {
      tx(doc, `(${roomView.toUpperCase()})`, col.b.x + 68, by, {
        size: 7,
        color: "#444444",
      });
      by += LH;
    }
    if (roomType) {
      tx(doc, `(${roomType.toUpperCase()})`, col.b.x + 68, by, {
        size: 7,
        color: "#444444",
      });
      by += LH;
    }
    if (board) {
      tx(doc, `(${board.toUpperCase()})`, col.b.x + 68, by, {
        size: 7,
        color: "#444444",
      });
      by += LH;
    }
  } else if (isCarR) {
    const colBRows = [
      ["Vehicle", d.brand || d.vehicle || "—"],
      ["Driver", d.driverName || "—"],
      ["Plate", d.plate || "—"],
    ].filter(([, v]) => v !== "—");
    for (const [label, value] of colBRows) {
      tx(doc, `${label} :`, col.b.x, by, { font: "Helvetica-Bold", size: 7 });
      tx(doc, value, col.b.x + 50, by, { size: 7 });
      by += LH;
    }
  } else {
    // Generic: show first few detail key-value pairs
    const entries = Object.entries(d).slice(0, 5);
    for (const [key, value] of entries) {
      tx(doc, `${capFirst(key)} :`, col.b.x, by, {
        font: "Helvetica-Bold",
        size: 7,
      });
      tx(doc, String(value), col.b.x + 70, by, {
        size: 7,
        width: col.b.w - 74,
      });
      by += LH;
    }
  }

  // ── Column C: pax ────────────────────────────────────────────────────────
  const allotment = d.allotment ?? d.allotmentType ?? "On-Request";
  const pax = booking.totalPax || {};
  const adults =
    pax.adults ??
    booking.customers?.filter((c) => (c.ageType || "adult") === "adult")
      .length ??
    0;
  const children =
    pax.kids ??
    booking.customers?.filter((c) => c.ageType === "child").length ??
    0;
  const infants =
    booking.customers?.filter((c) => c.ageType === "infant").length ?? 0;
  const total = pax.total ?? adults + children + infants;

  const colCRows = [
    ["Allotment", allotment],
    ["Adult", adults > 0 ? String(adults) : ""],
    ["Ext. Bed", d.extraBed ? String(d.extraBed) : ""],
    ["Child", children > 0 ? String(children) : ""],
    ["Infant", infants > 0 ? String(infants) : ""],
    ["Total Pax", String(total)],
  ];
  for (const [label, value] of colCRows) {
    tx(doc, `${label} :`, col.c.x, cy, { font: "Helvetica-Bold", size: 7 });
    tx(doc, value, col.c.x + 62, cy, { size: 7, font: "Helvetica-Bold" });
    cy += LH;
  }

  // Notes (if any)
  if (service.notes?.trim()) {
    const noteY = Math.max(ay, by, cy) + 4;
    tx(doc, `Notes: ${service.notes}`, col.a.x, noteY, {
      size: 7,
      color: "#555555",
      width: CONTENT_W - 22,
    });
    return noteY + 14;
  }

  const blockEnd = Math.max(ay, by, cy) + 10;
  hLine(doc, blockEnd, MARGIN, PAGE_W - MARGIN, 0.4, "#cccccc");
  return blockEnd + 4;
};

// ── Passenger table ───────────────────────────────────────────────────────────

const drawPassengerTable = (doc, customers, startY) => {
  const cols = [
    { label: "SURNAME, NAME", w: 138 },
    { label: "AGE/B.DATE", w: 65 },
    { label: "ARRIV.POINT", w: 68 },
    { label: "TIME", w: 36 },
    { label: "DEPAR.POINT", w: 68 },
    { label: "TIME", w: 36 },
    { label: "UB VOUCHE", w: CONTENT_W - 411 },
  ];

  const rowH = 14;
  const tableH = rowH * (1 + (customers?.length ?? 0));

  let y = startY;

  // Header row
  rect(doc, MARGIN, y, CONTENT_W, rowH, "#888888", 0.6);
  let x = MARGIN;
  for (const col of cols) {
    tx(doc, col.label, x + 3, y + 3, {
      font: "Helvetica-Bold",
      size: 6,
      width: col.w - 6,
    });
    x += col.w;
  }

  // Customer rows
  for (const customer of customers ?? []) {
    y += rowH;
    rect(doc, MARGIN, y, CONTENT_W, rowH, "#cccccc", 0.4);

    const title = guestTitle(customer.ageType);
    const fullName = `${title ? title + " " : ""}${customer.name ?? ""}`.trim();
    tx(doc, fullName, MARGIN + 3, y + 3, { size: 7, width: cols[0].w - 6 });

    // Draw vertical column separators
    let sx = MARGIN;
    for (let i = 0; i < cols.length - 1; i++) {
      sx += cols[i].w;
      vLine(doc, sx, y, y + rowH, 0.4, "#cccccc");
    }
  }

  return y + rowH + 8;
};

// ── Footer ────────────────────────────────────────────────────────────────────

const drawVoucherFooter = (doc, profile, booking, startY) => {
  hLine(doc, startY, MARGIN, PAGE_W - MARGIN, 0.7, "#888888");

  const y = startY + 6;
  const rightX = MARGIN + CONTENT_W / 2;
  const agentName = booking.createdBy?.userName ?? "";

  if (profile.email) {
    tx(doc, `E mail : ${profile.email}`, MARGIN + 4, y, { size: 7 });
  }
  if (profile.phone) {
    tx(doc, `Tel : ${profile.phone}`, MARGIN + 4, y + 11, { size: 7 });
  }

  tx(doc, "The Extra Expenses Belong To The Guest", rightX, y, {
    size: 7,
    font: "Helvetica-Bold",
    width: CONTENT_W / 2,
    align: "center",
  });
  if (agentName) {
    tx(doc, agentName.toUpperCase(), rightX, y + 11, {
      size: 7,
      font: "Helvetica-Bold",
      width: CONTENT_W / 2,
      align: "center",
    });
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds the voucher PDFKit document.
 *
 * @param {object} booking   - Lean booking document (services populated with provider)
 * @param {object|null} officeSettings - Lean OfficeSettings with optional `logoBuffer`
 * @param {string|null} serviceType    - Optional filter; null = all services
 */
export const createVoucherPdfDocument = (
  booking,
  officeSettings = null,
  serviceType = null,
) => {
  const profile = {
    officeName: officeSettings?.name || process.env.COMPANY_NAME || "Office",
    phone: officeSettings?.phone || process.env.COMPANY_PHONE || "",
    email: officeSettings?.email || process.env.COMPANY_EMAIL || "",
    logoBuffer: officeSettings?.logoBuffer ?? null,
  };

  let services = booking.services || [];
  if (serviceType) {
    services = services.filter((s) => s.serviceType === serviceType);
  }
  if (!services.length) {
    services = booking.services || [];
  }

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    autoFirstPage: true,
  });

  let y = drawHeader(doc, profile, services, booking);
  y += 4;
  y = drawVoucherRow(doc, booking, y);
  y += 2;

  for (let i = 0; i < services.length; i++) {
    y = drawServiceBlock(doc, services[i], i, booking, y);
    y += 2;
  }

  y += 4;
  y = drawPassengerTable(doc, booking.customers ?? [], y);

  drawVoucherFooter(doc, profile, booking, y + 4);

  return doc;
};

export const generateVoucherPdfBuffer = (
  booking,
  officeSettings = null,
  serviceType = null,
) =>
  new Promise((resolve, reject) => {
    const doc = createVoucherPdfDocument(booking, officeSettings, serviceType);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
