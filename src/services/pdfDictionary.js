/**
 * Server-side PDF translation dictionary.
 *
 * Mirrors the client-side i18n system but runs in Node.js where the
 * browser i18next instance is unavailable. All three PDF services
 * (invoicePdfService, receiptPdfService, voucherPdfService) import
 * `getPdfTranslator(lang)` from here.
 *
 * Font requirement
 * ───────────────
 * PDFKit's built-in fonts (Helvetica, Times-Roman, Courier) use
 * WinAnsiEncoding (Latin-1) and cannot render:
 *   • Arabic glyphs — requires an Arabic-capable OpenType/TTF font
 *   • Turkish ğ / ş / ı — require a Unicode TTF (e.g. Noto Sans)
 *
 * Set PDF_UNICODE_FONT in your .env to an absolute path to a .ttf file
 * that covers the glyphs you need.  When present, all PDF services
 * register and use it automatically via registerPdfFont(). When absent
 * the system falls back to Helvetica and renders what it can.
 *
 * Example .env:
 *   PDF_UNICODE_FONT=/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf
 *   PDF_UNICODE_FONT_BOLD=/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf
 */

// ── Font registration ─────────────────────────────────────────────────────────
import fs from "fs";

const FONT_REGULAR = process.env.PDF_UNICODE_FONT      || null;
const FONT_BOLD    = process.env.PDF_UNICODE_FONT_BOLD  || null;

export const PDF_FONTS = {
  regular:     FONT_REGULAR && fs.existsSync(FONT_REGULAR) ? "UniFont"     : "Helvetica",
  bold:        FONT_BOLD    && fs.existsSync(FONT_BOLD)    ? "UniFontBold" : "Helvetica-Bold",
  italic:      "Helvetica-Oblique",
  boldItalic:  "Helvetica-BoldOblique",
};

/**
 * Call once per PDFDocument before any text is written.
 * Idempotent — PDFKit silently ignores duplicate font registrations.
 */
export const registerPdfFont = (doc) => {
  if (FONT_REGULAR && fs.existsSync(FONT_REGULAR)) {
    doc.registerFont("UniFont",     FONT_REGULAR);
  }
  if (FONT_BOLD && fs.existsSync(FONT_BOLD)) {
    doc.registerFont("UniFontBold", FONT_BOLD);
  }
};

// ── Dictionary ────────────────────────────────────────────────────────────────

const PDF_DICT = {
  // ── English ────────────────────────────────────────────────────────────────
  en: {
    // Layout
    page:                "Page",
    dateLabel:           "Date",
    timeLabel:           "Time",
    agency:              "AGENCY",
    poweredBy:           "Powered by {brand} Booking ERP",

    // Voucher header titles
    hotelReservationForm:       "HOTEL RESERVATION FORM",
    apartmentReservationForm:   "APARTMENT RESERVATION FORM",
    carRentalVoucher:           "CAR RENTAL VOUCHER",
    transportationVoucher:      "TRANSPORTATION VOUCHER",
    excursionVoucher:           "EXCURSION VOUCHER",
    bookingVoucher:             "BOOKING VOUCHER",

    // Voucher field labels
    voucherNo:    "Voucher No",
    checkIn:      "C/In Date",
    checkOut:     "C/Out Date",
    nights:       "Night(s)",
    sejourCardNr: "Sejour Card Nr",
    roomType:     "Room Type",
    board:        "Board",
    statusOk:     "Ok",
    allotment:    "Allotment",
    onRequest:    "On-Request",
    adult:        "Adult",
    child:        "Child",
    infant:       "Infant",
    totalPax:     "Total Pax",
    extBed:       "Ext. Bed",
    pickUpDate:   "Pick-up Date",
    dropOffDate:  "Drop-off Date",
    days:         "Day(s)",
    vehicle:      "Vehicle",
    driver:       "Driver",
    destination:  "Destination",
    tripDate:     "Trip Date",
    address:      "Address",

    // Passenger table headers
    surnameCol:      "SURNAME, NAME",
    ageDobCol:       "AGE/B.DATE",
    arrivPointCol:   "ARRIV.POINT",
    timeCol:         "TIME",
    departPointCol:  "DEPAR.POINT",
    voucherCol:      "UB VOUCHE",
    extraExpenses:   "The Extra Expenses Belong To The Guest",

    // Invoice
    invoice:          "INVOICE",
    invoiceDetails:   "Invoice Details",
    invoiceNo:        "Invoice No.",
    issueDate:        "Issue Date",
    issuedBy:         "Issued By",
    billTo:           "Bill To",
    customers:        "Customer(s)",
    passengers:       "Passengers",
    booking:          "Booking",
    services:         "Services",
    serviceNo:        "#",
    service:          "Service",
    description:      "Description",
    provider:         "Provider",
    amount:           "Amount",
    noServices:       "No services listed.",
    moreServices:     "+ {n} more service(s) not shown",
    payments:         "Payments",
    morePayments:     "+ {n} earlier payment(s)",
    subtotal:         "Subtotal",
    totalPaid:        "Total Paid",
    balanceDue:       "Balance Due",
    paymentStatusLbl: "Status",
    thankYouInvoice:  "Thank you for choosing {office}. Present this invoice at your provider.",

    // Receipt
    receipt:            "RECEIPT",
    paymentReceipt:     "PAYMENT RECEIPT",
    providerPayment:    "PROVIDER PAYMENT",
    providerCollection: "PROVIDER COLLECTION",
    receiptNo:          "Receipt No.",
    transactionDate:    "Transaction Date",
    method:             "Method",
    recordedBy:         "Recorded By",
    notes:              "Notes",
    reference:          "Reference",
    thankYouReceipt:    "Thank you for choosing {office}. Keep this receipt for your records.",

    // Payment methods
    cash:         "Cash",
    bank_transfer:"Bank Transfer",
    check:        "Check",
    other:        "Other",

    // Footer
    emailLabel: "E mail",
    telLabel:   "Tel",
  },

  // ── Arabic ─────────────────────────────────────────────────────────────────
  // RTL note: PDFKit renders Arabic Unicode glyphs left-to-right unless an
  // Arabic-shaping library (e.g. pdfkit-arabicshaper) is used. With a proper
  // Unicode font + arabic shaper, these strings will display correctly.
  // Without a shaper, characters appear but in the wrong visual order.
  ar: {
    page:                "صفحة",
    dateLabel:           "التاريخ",
    timeLabel:           "الوقت",
    agency:              "الوكالة",
    poweredBy:           "مدعوم بواسطة {brand} Booking ERP",

    hotelReservationForm:       "نموذج حجز الفندق",
    apartmentReservationForm:   "نموذج حجز الشقة",
    carRentalVoucher:           "قسيمة تأجير السيارة",
    transportationVoucher:      "قسيمة النقل",
    excursionVoucher:           "قسيمة الرحلة",
    bookingVoucher:             "قسيمة الحجز",

    voucherNo:    "رقم القسيمة",
    checkIn:      "تاريخ الوصول",
    checkOut:     "تاريخ المغادرة",
    nights:       "ليلة",
    sejourCardNr: "رقم بطاقة الإقامة",
    roomType:     "نوع الغرفة",
    board:        "نظام الإقامة",
    statusOk:     "موافق",
    allotment:    "التخصيص",
    onRequest:    "حسب الطلب",
    adult:        "بالغ",
    child:        "طفل",
    infant:       "رضيع",
    totalPax:     "إجمالي المسافرين",
    extBed:       "سرير إضافي",
    pickUpDate:   "تاريخ الاستلام",
    dropOffDate:  "تاريخ التسليم",
    days:         "يوم",
    vehicle:      "السيارة",
    driver:       "السائق",
    destination:  "الوجهة",
    tripDate:     "تاريخ الرحلة",
    address:      "العنوان",

    surnameCol:      "الاسم واللقب",
    ageDobCol:       "العمر/تاريخ الميلاد",
    arrivPointCol:   "نقطة الوصول",
    timeCol:         "الوقت",
    departPointCol:  "نقطة المغادرة",
    voucherCol:      "القسيمة",
    extraExpenses:   "المصاريف الإضافية تعود على الضيف",

    invoice:          "فاتورة",
    invoiceDetails:   "تفاصيل الفاتورة",
    invoiceNo:        "رقم الفاتورة",
    issueDate:        "تاريخ الإصدار",
    issuedBy:         "صادرة بواسطة",
    billTo:           "فاتورة إلى",
    customers:        "العملاء",
    passengers:       "المسافرون",
    booking:          "الحجز",
    services:         "الخدمات",
    serviceNo:        "#",
    service:          "الخدمة",
    description:      "الوصف",
    provider:         "المزود",
    amount:           "المبلغ",
    noServices:       "لا توجد خدمات مدرجة.",
    moreServices:     "+ {n} خدمة إضافية غير معروضة",
    payments:         "المدفوعات",
    morePayments:     "+ {n} مدفوعات سابقة",
    subtotal:         "المجموع الفرعي",
    totalPaid:        "إجمالي المدفوع",
    balanceDue:       "الرصيد المستحق",
    paymentStatusLbl: "الحالة",
    thankYouInvoice:  "شكراً لاختياركم {office}. قدم هذه الفاتورة لمزود الخدمة.",

    receipt:            "إيصال",
    paymentReceipt:     "إيصال دفع",
    providerPayment:    "دفعة للمزود",
    providerCollection: "تحصيل من المزود",
    receiptNo:          "رقم الإيصال",
    transactionDate:    "تاريخ المعاملة",
    method:             "طريقة الدفع",
    recordedBy:         "سجّله",
    notes:              "ملاحظات",
    reference:          "المرجع",
    thankYouReceipt:    "شكراً لاختياركم {office}. احتفظ بهذا الإيصال لسجلاتك.",

    cash:         "نقدي",
    bank_transfer:"تحويل بنكي",
    check:        "شيك",
    other:        "أخرى",

    emailLabel: "البريد الإلكتروني",
    telLabel:   "هاتف",
  },

  // ── Turkish ────────────────────────────────────────────────────────────────
  // Note: characters ğ/ş/ı/ö/ü/ç require a Unicode TTF (PDF_UNICODE_FONT).
  // With Helvetica fallback they render as their nearest ASCII equivalent.
  tr: {
    page:                "Sayfa",
    dateLabel:           "Tarih",
    timeLabel:           "Saat",
    agency:              "ACENTE",
    poweredBy:           "{brand} Booking ERP tarafindan desteklenmektedir",

    hotelReservationForm:       "OTEL REZERVASYON FORMU",
    apartmentReservationForm:   "APARTMAN REZERVASYON FORMU",
    carRentalVoucher:           "ARAC KIRALAMA KUPONU",
    transportationVoucher:      "ULASIM KUPONU",
    excursionVoucher:           "EKSURSIYON KUPONU",
    bookingVoucher:             "REZERVASYON KUPONU",

    voucherNo:    "Kupon No",
    checkIn:      "Giris Tarihi",
    checkOut:     "Cikis Tarihi",
    nights:       "Gece",
    sejourCardNr: "Konaklama Kart No",
    roomType:     "Oda Tipi",
    board:        "Pansiyon",
    statusOk:     "Tamam",
    allotment:    "Kontenjan",
    onRequest:    "Talep Uzerine",
    adult:        "Yetiskin",
    child:        "Cocuk",
    infant:       "Bebek",
    totalPax:     "Toplam Kisi",
    extBed:       "Ekstra Yatak",
    pickUpDate:   "Alinma Tarihi",
    dropOffDate:  "Birakilma Tarihi",
    days:         "Gun",
    vehicle:      "Arac",
    driver:       "Sofor",
    destination:  "Destinasyon",
    tripDate:     "Tur Tarihi",
    address:      "Adres",

    surnameCol:      "SOYAD, AD",
    ageDobCol:       "YAS/DOGUM TAR.",
    arrivPointCol:   "VARIS NOKTASI",
    timeCol:         "SAAT",
    departPointCol:  "KALKIS NOKTASI",
    voucherCol:      "KUPON",
    extraExpenses:   "Ekstra Masraflar Misafire Aittir",

    invoice:          "FATURA",
    invoiceDetails:   "Fatura Detaylari",
    invoiceNo:        "Fatura No.",
    issueDate:        "Duzenleme Tarihi",
    issuedBy:         "Duzenleyen",
    billTo:           "Fatura Edilecek",
    customers:        "Musteri(ler)",
    passengers:       "Yolcular",
    booking:          "Rezervasyon",
    services:         "Hizmetler",
    serviceNo:        "#",
    service:          "Hizmet",
    description:      "Aciklama",
    provider:         "Tedarikci",
    amount:           "Tutar",
    noServices:       "Listelenen hizmet yok.",
    moreServices:     "+ {n} daha fazla hizmet gosterilmiyor",
    payments:         "Odemeler",
    morePayments:     "+ {n} onceki odeme",
    subtotal:         "Ara Toplam",
    totalPaid:        "Toplam Odenen",
    balanceDue:       "Kalan Bakiye",
    paymentStatusLbl: "Durum",
    thankYouInvoice:  "{office}'i tercih ettiginiz icin tesekkurler. Bu faturay tedarikcinize ibraz edin.",

    receipt:            "MAKBUZ",
    paymentReceipt:     "ODEME MAKBUZU",
    providerPayment:    "TEDARIKCI ODEMESI",
    providerCollection: "TEDARIKCI TAHSILATI",
    receiptNo:          "Makbuz No.",
    transactionDate:    "Islem Tarihi",
    method:             "Odeme Yontemi",
    recordedBy:         "Kaydeden",
    notes:              "Notlar",
    reference:          "Referans",
    thankYouReceipt:    "{office}'i tercih ettiginiz icin tesekkurler. Bu makbuzu kayitlariniz icin saklayin.",

    cash:         "Nakit",
    bank_transfer:"Banka Transferi",
    check:        "Cek",
    other:        "Diger",

    emailLabel: "E-posta",
    telLabel:   "Tel",
  },
};

/**
 * Returns a translator function for the given language.
 *
 * Usage:
 *   const t = getPdfTranslator(officeSettings?.pdfLanguage);
 *   t("checkIn")                    → "C/In Date"  (en)
 *   t("moreServices", { n: 3 })     → "+ 3 more service(s) not shown"
 */
export const getPdfTranslator = (lang = "en") => {
  const dict    = PDF_DICT[lang] || PDF_DICT.en;
  const fallback = PDF_DICT.en;

  return (key, vars = {}) => {
    let str = dict[key] ?? fallback[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return str;
  };
};
