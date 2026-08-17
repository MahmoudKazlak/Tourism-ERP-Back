/**
 * PDFKit-based Service Voucher PDF.
 * Matches the "HOTEL RESERVATION FORM" layout in the product spec.
 *
 * Field names verified against ServiceDetailsForm.jsx:
 *   accommodation : checkIn, checkOut, roomType, board
 *   apartRent     : checkIn, checkOut, address
 *   carRental     : brand, pickUp, dropOff
 *   carWithDriver : brand, driverName
 *   trip          : destination, date
 */
import PDFDocument from "pdfkit";
import fs          from "fs";
import path        from "path";
import { fileURLToPath } from "url";
import SVGtoPDF    from "svg-to-pdfkit";
import { getPdfTranslator, registerPdfFont, PDF_FONTS } from "./pdfDictionary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_SVG  = path.join(__dirname, "../../assets/kazlak-mark.svg");

const MARGIN    = 40;
const PAGE_W    = 595;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

const pad4 = (n) => String(n ?? 0).padStart(4, "0");

const fmtDate = (v) => {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};

const fmtNow = () => {
  const d = new Date();
  return {
    date: d.toLocaleDateString("en-GB",  { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB",  { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
};

const capFirst = (s) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";

const guestTitle = (ageType) => {
  switch ((ageType ?? "adult").toLowerCase()) {
    case "adult":  return "Mr/Ms";
    case "child":  return "Mstr";
    case "infant": return "Inf";
    default:       return capFirst(ageType);
  }
};

const tx = (doc, text, x, y, opts = {}) => {
  const {
    font = PDF_FONTS.regular, size = 7.5,
    color = "#000000", width, align, lineBreak = false,
  } = opts;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ""), x, y, {
    lineBreak, ...(width ? { width } : {}), ...(align ? { align } : {}),
  });
};

const hLine = (doc, y, x1 = MARGIN, x2 = PAGE_W - MARGIN, w = 0.5, c = "#cccccc") =>
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(c).lineWidth(w).stroke();

const vLine = (doc, x, y1, y2, w = 0.5, c = "#cccccc") =>
  doc.moveTo(x, y1).lineTo(x, y2).strokeColor(c).lineWidth(w).stroke();

const drawRect = (doc, x, y, w, h, stroke = "#cccccc", lw = 0.5) =>
  doc.rect(x, y, w, h).strokeColor(stroke).lineWidth(lw).stroke();

// ── Document title based on service types ─────────────────────────────────────

const getDocTitle = (services, t) => {
  const types = [...new Set(services.map((s) => s.serviceType))];
  if (types.length === 1) {
    switch (types[0]) {
      case "accommodation": return t("hotelReservationForm");
      case "apartRent":     return t("apartmentReservationForm");
      case "carRental":     return t("carRentalVoucher");
      case "carWithDriver": return t("transportationVoucher");
      case "trip":          return t("excursionVoucher");
    }
  }
  return t("bookingVoucher");
};

// ── Header ────────────────────────────────────────────────────────────────────

const drawHeader = (doc, profile, services, booking, t) => {
  const now    = fmtNow();
  const y0     = MARGIN;
  const hdrH   = 100;

  drawRect(doc, MARGIN, y0, CONTENT_W, hdrH, "#888888", 0.7);

  // Left: app logo
  const logoSize = 36;
  if (fs.existsSync(LOGO_SVG)) {
    try {
      const svg = fs.readFileSync(LOGO_SVG, "utf8");
      SVGtoPDF(doc, svg, MARGIN + 6, y0 + 8, {
        width: logoSize, height: logoSize, preserveAspectRatio: "xMidYMid meet",
      });
    } catch (_) {}
  } else if (profile.logoBuffer) {
    try { doc.image(profile.logoBuffer, MARGIN + 6, y0 + 8, { height: logoSize }); } catch (_) {}
  }

  // Centre: office + document type + provider + city
  const cx = MARGIN + 80;
  const cw = CONTENT_W - 80 - 100;
  let cy = y0 + 10;
  tx(doc, profile.officeName,        cx, cy, { font: PDF_FONTS.boldItalic, size: 11, width: cw, align: "center" }); cy += 14;
  tx(doc, getDocTitle(services, t),  cx, cy, { font: PDF_FONTS.boldItalic, size: 9,  width: cw, align: "center" }); cy += 12;

  const accom = services.find((s) => ["accommodation","apartRent"].includes(s.serviceType))
             ?? services[0];
  const hotelName = accom?.provider?.name ?? "";
  const city      = (accom?.provider?.address ?? "").split(/[\n,]/)[0].trim();
  if (hotelName) { tx(doc, hotelName.toUpperCase(), cx, cy, { font: PDF_FONTS.bold, size: 9, width: cw, align: "center", color: "#222222" }); cy += 12; }
  if (city)      { tx(doc, city.toUpperCase(),      cx, cy, { font: PDF_FONTS.bold, size: 9, width: cw, align: "center" }); }

  // Right: date / time / page
  const rx = PAGE_W - MARGIN - 95;
  let ry = y0 + 12;
  tx(doc, `${t("dateLabel")} : ${now.date}`, rx, ry, { size: 7 }); ry += 11;
  tx(doc, `${t("timeLabel")} : ${now.time}`, rx, ry, { size: 7 }); ry += 11;
  tx(doc, `${t("page")}    : 1`,             rx, ry, { size: 7 });

  return y0 + hdrH;
};

// ── Voucher number + status ───────────────────────────────────────────────────

const drawVoucherRow = (doc, booking, startY, t) => {
  const y = startY + 8;
  tx(doc, `${t("voucherNo")} : ${pad4(booking.bookingID)}`, MARGIN + 4, y, { font: PDF_FONTS.bold, size: 10 });
  tx(doc, (booking.status ?? "new").toUpperCase(), MARGIN, y - 2, {
    font: PDF_FONTS.bold, size: 18, color: "#111111", width: CONTENT_W, align: "center",
  });
  hLine(doc, startY + 28, MARGIN, PAGE_W - MARGIN, 0.7, "#888888");
  return startY + 32;
};

// ── Service block ─────────────────────────────────────────────────────────────

const drawServiceBlock = (doc, service, idx, booking, startY, t) => {
  const d   = service.details || {};
  const LH  = 11.5;

  const col = {
    a: { x: MARGIN + 18,  w: 148 },
    b: { x: MARGIN + 171, w: 195 },
    c: { x: MARGIN + 371, w: CONTENT_W - 371 },
  };

  let y = startY + 8;

  // Row number
  tx(doc, `${idx + 1}.`, MARGIN + 3, y, { font: PDF_FONTS.bold, size: 8 });

  let ay = y, by = y, cy = y;

  // ── Column A: dates/stay info ──────────────────────────────────────────────
  switch (service.serviceType) {

    case "accommodation":
    case "apartRent": {
      const rows = [
        [t("checkIn"),      fmtDate(d.checkIn)],
        [t("checkOut"),     fmtDate(d.checkOut)],
        [t("nights"),       service.duration != null ? `${service.duration}` : "—"],
        [t("sejourCardNr"), service.serviceNumber != null ? String(service.serviceNumber) : "—"],
      ];
      for (const [label, val] of rows) {
        tx(doc, `${label} :`, col.a.x, ay, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, val, col.a.x + 76, ay, { font: PDF_FONTS.bold, size: 7 });
        ay += LH;
      }
      break;
    }

    case "carRental":
    case "carWithDriver": {
      const rows = [
        [t("pickUpDate"),  fmtDate(d.pickUp)],
        [t("dropOffDate"), fmtDate(d.dropOff)],
        [t("days"),        service.duration != null ? `${service.duration}` : "—"],
      ];
      for (const [label, val] of rows) {
        tx(doc, `${label} :`, col.a.x, ay, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, val, col.a.x + 82, ay, { size: 7 });
        ay += LH;
      }
      break;
    }

    case "trip": {
      tx(doc, `${t("tripDate")} :`, col.a.x, ay, { font: PDF_FONTS.bold, size: 7 });
      tx(doc, fmtDate(d.date),     col.a.x + 60, ay, { size: 7 });
      ay += LH;
      break;
    }

    default: {
      // Generic: show date if any durationFields-compatible value exists
      const dateVal = d.from ?? d.date ?? d.startDate;
      if (dateVal) {
        tx(doc, `${t("dateLabel")} :`, col.a.x, ay, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, fmtDate(dateVal), col.a.x + 44, ay, { size: 7 });
        ay += LH;
      }
      if (service.duration != null) {
        tx(doc, `${t("days")} :`, col.a.x, ay, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, String(service.duration), col.a.x + 38, ay, { size: 7 });
        ay += LH;
      }
    }
  }

  // ── Column B: service-specific details ────────────────────────────────────
  switch (service.serviceType) {

    case "accommodation": {
      // Only fields actually stored by ServiceDetailsForm: roomType, board
      const rows = [
        [t("roomType"), d.roomType || "—"],
        [t("board"),    d.board    || "—"],
        [t("statusOk"), t("statusOk")],   // static "Ok" — not a stored field
      ];
      for (const [label, val] of rows) {
        tx(doc, `${label} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, val, col.b.x + 64, by, { font: PDF_FONTS.bold, size: 7 });
        by += LH;
      }
      // Descriptive lines (parenthetical) for stored values
      by += 3;
      if (d.roomType) { tx(doc, `(${d.roomType.toUpperCase()})`, col.b.x + 64, by, { size: 7, color: "#444444" }); by += LH; }
      if (d.board)    { tx(doc, `(${d.board.toUpperCase()})`,    col.b.x + 64, by, { size: 7, color: "#444444" }); by += LH; }
      break;
    }

    case "apartRent": {
      if (d.address) {
        tx(doc, `${t("address")} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, d.address, col.b.x + 50, by, { size: 7, width: col.b.w - 54 });
        by += LH;
      }
      break;
    }

    case "carRental": {
      if (d.brand) {
        tx(doc, `${t("vehicle")} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, d.brand, col.b.x + 50, by, { size: 7 });
        by += LH;
      }
      break;
    }

    case "carWithDriver": {
      const bRows = [
        [t("vehicle"), d.brand      || "—"],
        [t("driver"),  d.driverName || "—"],
      ];
      for (const [label, val] of bRows) {
        tx(doc, `${label} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, val, col.b.x + 48, by, { size: 7 });
        by += LH;
      }
      break;
    }

    case "trip": {
      if (d.destination) {
        tx(doc, `${t("destination")} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, d.destination, col.b.x + 68, by, { size: 7 });
        by += LH;
      }
      break;
    }

    default: {
      // Generic: show first 4 detail entries
      for (const [k, v] of Object.entries(d).slice(0, 4)) {
        tx(doc, `${capFirst(k)} :`, col.b.x, by, { font: PDF_FONTS.bold, size: 7 });
        tx(doc, String(v), col.b.x + 64, by, { size: 7, width: col.b.w - 68 });
        by += LH;
      }
    }
  }

  // ── Column C: pax ─────────────────────────────────────────────────────────
  const pax     = booking.totalPax || {};
  const adults  = pax.adults  ?? booking.customers?.filter((c) => (c.ageType ?? "adult") === "adult").length  ?? 0;
  const children = pax.kids   ?? booking.customers?.filter((c) => c.ageType === "child").length               ?? 0;
  const infants  = booking.customers?.filter((c) => c.ageType === "infant").length                            ?? 0;
  const total    = pax.total  ?? (adults + children + infants);

  const colCRows = [
    [t("allotment"),  t("onRequest")],
    [t("adult"),      adults   > 0 ? String(adults)   : ""],
    [t("extBed"),     ""],
    [t("child"),      children > 0 ? String(children) : ""],
    [t("infant"),     infants  > 0 ? String(infants)  : ""],
    [t("totalPax"),   String(total)],
  ];
  for (const [label, val] of colCRows) {
    tx(doc, `${label} :`, col.c.x, cy, { font: PDF_FONTS.bold, size: 7 });
    tx(doc, val, col.c.x + 70, cy, { font: PDF_FONTS.bold, size: 7 });
    cy += LH;
  }

  // Notes (if any)
  const blockEnd = Math.max(ay, by, cy) + 6;
  if (service.notes?.trim()) {
    tx(doc, service.notes, col.a.x, blockEnd, { size: 7, color: "#555555", width: CONTENT_W - 22 });
    hLine(doc, blockEnd + 14, MARGIN, PAGE_W - MARGIN, 0.4, "#cccccc");
    return blockEnd + 18;
  }
  hLine(doc, blockEnd, MARGIN, PAGE_W - MARGIN, 0.4, "#cccccc");
  return blockEnd + 4;
};

// ── Passenger table ───────────────────────────────────────────────────────────

const drawPassengerTable = (doc, customers, startY, t) => {
  const cols = [
    { label: t("surnameCol"),     w: 138 },
    { label: t("ageDobCol"),      w: 65  },
    { label: t("arrivPointCol"),  w: 68  },
    { label: t("timeCol"),        w: 36  },
    { label: t("departPointCol"), w: 68  },
    { label: t("timeCol"),        w: 36  },
    { label: t("voucherCol"),     w: CONTENT_W - 411 },
  ];

  const rowH = 14;
  let y = startY;

  // Header row
  drawRect(doc, MARGIN, y, CONTENT_W, rowH, "#888888", 0.7);
  let hx = MARGIN;
  for (const col of cols) {
    tx(doc, col.label, hx + 3, y + 3, { font: PDF_FONTS.bold, size: 6, width: col.w - 6 });
    hx += col.w;
  }

  // Customer rows
  for (const customer of customers ?? []) {
    y += rowH;
    drawRect(doc, MARGIN, y, CONTENT_W, rowH, "#cccccc", 0.4);
    const name = `${guestTitle(customer.ageType)} ${customer.name ?? ""}`.trim();
    tx(doc, name, MARGIN + 3, y + 3, { size: 7, width: cols[0].w - 6 });
    // Vertical separators
    let sx = MARGIN;
    for (let i = 0; i < cols.length - 1; i++) {
      sx += cols[i].w;
      vLine(doc, sx, y, y + rowH, 0.4, "#cccccc");
    }
  }

  return y + rowH + 8;
};

// ── Footer ────────────────────────────────────────────────────────────────────

const drawVoucherFooter = (doc, profile, booking, startY, t) => {
  hLine(doc, startY, MARGIN, PAGE_W - MARGIN, 0.7, "#888888");
  const y       = startY + 7;
  const rightX  = MARGIN + CONTENT_W / 2;
  const agent   = booking.createdBy?.userName ?? "";

  if (profile.email) tx(doc, `${t("emailLabel")} : ${profile.email}`, MARGIN + 4, y,      { size: 7 });
  if (profile.phone) tx(doc, `${t("telLabel")} : ${profile.phone}`,   MARGIN + 4, y + 11, { size: 7 });

  tx(doc, t("extraExpenses"), rightX, y, {
    font: PDF_FONTS.bold, size: 7, width: CONTENT_W / 2, align: "center",
  });
  if (agent) {
    tx(doc, agent.toUpperCase(), rightX, y + 11, {
      font: PDF_FONTS.bold, size: 7, width: CONTENT_W / 2, align: "center",
    });
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {object} booking        — Lean booking document, services.provider populated
 * @param {object|null} officeSettings — Extended with optional `logoBuffer`
 * @param {string|null} serviceType   — Filter to one type; null = all
 */
export const createVoucherPdfDocument = (booking, officeSettings = null, serviceType = null) => {
  const lang = officeSettings?.pdfLanguage || "en";
  const t    = getPdfTranslator(lang);

  const profile = {
    officeName: officeSettings?.name  || process.env.COMPANY_NAME  || "Office",
    phone:      officeSettings?.phone || process.env.COMPANY_PHONE || "",
    email:      officeSettings?.email || process.env.COMPANY_EMAIL || "",
    logoBuffer: officeSettings?.logoBuffer ?? null,
  };

  let services = booking.services || [];
  if (serviceType) services = services.filter((s) => s.serviceType === serviceType);
  if (!services.length) services = booking.services || [];

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true });
  registerPdfFont(doc);

  let y = drawHeader(doc, profile, services, booking, t);
  y += 4;
  y = drawVoucherRow(doc, booking, y, t);
  y += 2;
  for (let i = 0; i < services.length; i++) {
    y = drawServiceBlock(doc, services[i], i, booking, y, t);
    y += 2;
  }
  y += 4;
  y = drawPassengerTable(doc, booking.customers ?? [], y, t);
  drawVoucherFooter(doc, profile, booking, y + 4, t);

  return doc;
};

export const generateVoucherPdfBuffer = (booking, officeSettings = null, serviceType = null) =>
  new Promise((resolve, reject) => {
    const doc    = createVoucherPdfDocument(booking, officeSettings, serviceType);
    const chunks = [];
    doc.on("data",  (c) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
