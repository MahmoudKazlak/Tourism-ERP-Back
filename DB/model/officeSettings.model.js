import mongoose from "mongoose";

/**
 * Singleton document — exactly one per database.
 * The controller uses findOne() + create-if-missing (upsert pattern).
 *
 * Stores the customer-facing office identity printed on all PDF outputs.
 * Kazlak platform branding (logo + name) is separate and immutable.
 */
const officeSettingsSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "My Office",
      trim: true,
      maxlength: [100, "Office name is too long"],
    },
    address: { type: String, default: "", trim: true, maxlength: 200 },
    phone: { type: String, default: "", trim: true, maxlength: 30 },
    email: { type: String, default: "", trim: true, maxlength: 100 },
    logoUrl: { type: String, default: null },
    logoPublicId: { type: String, default: null },

    /**
     * Language used when generating PDFs (invoices, receipts, vouchers).
     * Independent of the UI language selected by individual users —
     * this is a per-office setting so all printouts are consistent
     * regardless of who is logged in.
     *
     * "en" → English (default, works with built-in Helvetica font)
     * "ar" → Arabic  (requires PDF_UNICODE_FONT env var — see pdfDictionary.js)
     * "tr" → Turkish (requires PDF_UNICODE_FONT for ğ/ş/ı/ö/ü/ç glyphs)
     */
    pdfLanguage: {
      type: String,
      enum: ["en", "ar", "tr"],
      default: "en",
    },
  },
  { timestamps: true },
);

export default mongoose.model("OfficeSettings", officeSettingsSchema);
