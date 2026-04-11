import { v2 as cloudinary } from "cloudinary";

/**
 * Configures Cloudinary from environment variables.
 * Called once at module load time.
 *
 * Required env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads an image buffer to Cloudinary.
 *
 * @param {Buffer} buffer - Raw image bytes (from multer memoryStorage).
 * @param {string} [folder="profiles"] - Cloudinary folder to store in.
 * @returns {Promise<import('cloudinary').UploadApiResponse>}
 */
export const uploadImage = (buffer, folder = "profiles") => {
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
