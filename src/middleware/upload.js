import multer from "multer";

// Store uploaded files in memory so we can stream them directly to Cloudinary
// without writing temporary files to disk.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(
      new Error("Only image files are allowed (jpeg, png, webp, etc.)"),
      false,
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB hard cap
  },
});

/**
 * Middleware: accept a single image field named "image".
 * Attach file to req.file as a Buffer via memoryStorage.
 */
export const uploadSingle = upload.single("image");

/**
 * Error-normalising wrapper for multer.
 * Converts MulterError into a structured JSON response instead of
 * leaking the raw error object to the global handler.
 */
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "File too large. Maximum allowed size is 5 MB.",
      LIMIT_UNEXPECTED_FILE:
        "Unexpected field name. Use 'image' as the field key.",
    };
    return res.status(400).json({
      success: false,
      message: messages[err.code] || err.message,
      errors: null,
    });
  }
  if (err) {
    return res
      .status(400)
      .json({ success: false, message: err.message, errors: null });
  }
  next();
};
