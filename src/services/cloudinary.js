import { v2 as cloudinary } from "cloudinary";

/**
 * Applies Cloudinary config from environment variables.
 *
 * WHY LAZY (called per-function instead of at module load):
 *   With ESM, all `import` statements are resolved before the importing
 *   module's body executes. This means `cloudinary.config()` at module-
 *   level runs BEFORE `dotenv.config()` in app.js — so process.env vars
 *   loaded from the .env file are undefined at that point.
 *
 *   Calling applyConfig() at the start of each exported function guarantees
 *   we read process.env after dotenv has run, regardless of import order.
 *   The config() call is idempotent and costs ~0ms.
 *
 * Required env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const applyConfig = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
};

/**
 * Uploads an image buffer to Cloudinary.
 *
 * @param {Buffer} buffer - Raw image bytes (from multer memoryStorage).
 * @param {string} [folder="profiles"] - Cloudinary folder to store in.
 * @returns {Promise<import('cloudinary').UploadApiResponse>}
 */
export const uploadImage = (buffer, folder = "profiles") => {
  applyConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", quality: "auto", fetch_format: "auto" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
    stream.end(buffer);
  });
};

/**
 * Deletes an image from Cloudinary by its public ID.
 * Extracts the public ID from a full Cloudinary URL if needed.
 *
 * @param {string} publicIdOrUrl - Cloudinary public_id or full URL.
 * @returns {Promise<import('cloudinary').DeleteApiResponse>}
 */
export const deleteImage = (publicIdOrUrl) => {
  applyConfig();
  // If a full URL was stored, extract the public_id segment.
  // Cloudinary URLs follow: .../upload/v<version>/<public_id>.<ext>
  let publicId = publicIdOrUrl;
  if (publicIdOrUrl.startsWith("http")) {
    const parts = publicIdOrUrl.split("/upload/");
    if (parts[1]) {
      // Strip version prefix (v1234567890/) if present, then remove extension.
      publicId = parts[1].replace(/^v\d+\//, "").replace(/\.[^.]+$/, "");
    }
  }
  return cloudinary.uploader.destroy(publicId);
};
