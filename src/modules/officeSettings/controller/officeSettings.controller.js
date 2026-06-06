import { asyncHandler } from "../../../middleware/asyncHandler.js";
import officeSettingsModel from "../../../../DB/model/officeSettings.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { uploadImage, deleteImage } from "../../../services/cloudinary.js";

/**
 * Ensures the singleton settings document exists and returns it.
 * Idempotent — safe to call on every request.
 */
const getOrCreate = async () => {
  let doc = await officeSettingsModel.findOne();
  if (!doc) doc = await officeSettingsModel.create({});
  return doc;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/office-settings
// All authenticated users may read (name/logo are not sensitive).
// ─────────────────────────────────────────────────────────────────────────────
export const getSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreate();
  return res.status(200).json({
    success: true,
    message: "Office settings retrieved",
    data: { settings },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/office-settings
// Admin only. Accepts multipart/form-data so a logo file can be uploaded
// in the same request as the text fields.
//
// Body fields (all optional):
//   name, address, phone, email  — text
//   removeLogo = "true"          — clears the existing logo
//   image (file)                 — new logo (handled by uploadSingle middleware)
// ─────────────────────────────────────────────────────────────────────────────
export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreate();

  const { name, address, phone, email, removeLogo } = req.body;

  if (name !== undefined)    settings.name    = String(name).trim();
  if (address !== undefined) settings.address = String(address).trim();
  if (phone !== undefined)   settings.phone   = String(phone).trim();
  if (email !== undefined)   settings.email   = String(email).trim();

  // ── Logo removal ──────────────────────────────────────────────────────────
  const shouldRemove = removeLogo === "true" || removeLogo === true;
  if (shouldRemove && settings.logoPublicId) {
    await deleteImage(settings.logoPublicId).catch((e) =>
      console.warn("⚠️  Could not delete old logo from Cloudinary:", e.message),
    );
    settings.logoUrl      = null;
    settings.logoPublicId = null;
  }

  // ── Logo upload (replaces any existing logo) ──────────────────────────────
  if (req.file) {
    if (settings.logoPublicId && !shouldRemove) {
      await deleteImage(settings.logoPublicId).catch(() => {});
    }
    const result = await uploadImage(req.file.buffer, "office-logos");
    settings.logoUrl      = result.secure_url;
    settings.logoPublicId = result.public_id;
  }

  await settings.save();

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_OFFICE_SETTINGS",
    details: {
      updatedFields: Object.keys(req.body).filter((k) => k !== "removeLogo"),
      logoUpdated: !!req.file,
      logoRemoved: shouldRemove,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Office settings updated successfully",
    data: { settings },
    errors: null,
  });
});
