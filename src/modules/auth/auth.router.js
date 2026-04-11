import { Router } from "express";
import * as authController from "./controller/auth.controller.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validation } from "../../middleware/validation.js";
import * as validators from "./auth.validation.js";
import { auth } from "../../middleware/auth.js";
import { uploadSingle, handleUploadError } from "../../middleware/upload.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// ── Public routes ──────────────────────────────────────────────────────────
router.post("/signin", asyncHandler(authController.signIn));
router.post("/sendCode", asyncHandler(authController.sendCode));
router.post("/forgotPassword", asyncHandler(authController.forgotPassword));

// Feature [4]: Token refresh and logout endpoints.
// Refresh uses the long-lived refresh token to issue a new access token.
// Logout invalidates the refresh token (stored in DB by hash).
router.post("/refresh", asyncHandler(authController.refreshToken));
router.post("/logout", auth(endpoint.All), asyncHandler(authController.logout));

// ── Admin: user management ─────────────────────────────────────────────────
router.post(
  "/createUser",
  auth(endpoint.AdminOnly),
  validation(validators.createUser),
  asyncHandler(authController.createUser),
);

// FIX [3]: Added Joi validation that was previously missing on this route.
router.patch(
  "/update/:id",
  auth(endpoint.AdminOnly),
  validation(validators.updateUser),
  asyncHandler(authController.updateUser),
);

router.get(
  "/",
  auth(endpoint.AdminOnly),
  asyncHandler(authController.getAllUsers),
);

// Feature [5]: Profile image upload via Cloudinary.
// Uses multer memoryStorage → streams buffer to Cloudinary.
router.post(
  "/:id/upload-image",
  auth(endpoint.AdminOnly),
  uploadSingle,
  handleUploadError,
  asyncHandler(authController.uploadUserImage),
);

export default router;
