import { Router } from "express";
import * as authController from "./controller/auth.controller.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validation } from "../../middleware/validation.js";
import * as validators from "./auth.validation.js";
import { auth } from "../../middleware/auth.js";
import { uploadSingle, handleUploadError } from "../../middleware/upload.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post("/signin", asyncHandler(authController.signIn));
router.post("/sendCode", asyncHandler(authController.sendCode));
router.post("/forgotPassword", asyncHandler(authController.forgotPassword));
router.post("/refresh", asyncHandler(authController.refreshToken));

// ── Authenticated: any role ───────────────────────────────────────────────────

// Logout current session
router.post("/logout", auth(endpoint.All), asyncHandler(authController.logout));

// NEW: Logout from all devices
router.post(
  "/logout-all",
  auth(endpoint.All),
  asyncHandler(authController.logoutAll),
);

// NEW: Get own profile
router.get("/me", auth(endpoint.All), asyncHandler(authController.getMe));

// NEW: Update own profile (userName, phone, password only)
router.patch(
  "/me",
  auth(endpoint.All),
  validation(validators.updateSelf),
  asyncHandler(authController.updateSelf),
);

// ── Admin: user management ────────────────────────────────────────────────────
router.post(
  "/createUser",
  auth(endpoint.AdminOnly),
  validation(validators.createUser),
  asyncHandler(authController.createUser),
);

router.get(
  "/",
  auth(endpoint.AdminOnly),
  asyncHandler(authController.getAllUsers),
);

router.patch(
  "/update/:id",
  auth(endpoint.AdminOnly),
  validation(validators.updateUser),
  asyncHandler(authController.updateUser),
);

// NEW: Delete a user
router.delete(
  "/delete/:id",
  auth(endpoint.AdminOnly),
  validation(validators.userIdParam),
  asyncHandler(authController.deleteUser),
);

// Profile image upload
router.post(
  "/:id/upload-image",
  auth(endpoint.AdminOnly),
  uploadSingle,
  handleUploadError,
  asyncHandler(authController.uploadUserImage),
);

export default router;
