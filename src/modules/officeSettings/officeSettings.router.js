import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { uploadSingle, handleUploadError } from "../../middleware/upload.js";
import * as officeSettingsController from "./controller/officeSettings.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// GET /api/v1/office-settings
router.get("/", auth(endpoint.All), officeSettingsController.getSettings);

// PATCH /api/v1/office-settings
// uploadSingle accepts an optional "image" file field; handleUploadError
// converts MulterErrors to clean 400 responses.
router.patch(
  "/",
  auth(endpoint.AdminOnly),
  uploadSingle,
  handleUploadError,
  officeSettingsController.updateSettings,
);

export default router;
