import mongoose from "mongoose";

/**
 * Singleton document — exactly one per database.
 * The controller uses findOne() + create-if-missing (upsert pattern).
 *
 * Stores the customer-facing office identity that prints on PDF invoices.
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
    // Cloudinary URL for the office logo — printed on PDF invoices
    logoUrl: { type: String, default: null },
    // Stored for deletion when the logo is replaced or removed
    logoPublicId: { type: String, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("OfficeSettings", officeSettingsSchema);
