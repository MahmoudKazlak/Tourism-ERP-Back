import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerController from "./controller/provider.controller.js";
import * as validators from "./provider.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// ── Static routes before dynamic ones ────────────────────────────────────────

// POST /api/v1/provider/resync-all — rebuild all provider summaries (migration)
router.post(
  "/resync-all",
  auth(endpoint.AdminOnly),
  providerController.resyncAllProviders,
);

// ── Standard CRUD ─────────────────────────────────────────────────────────────

router.post(
  "/create",
  auth(endpoint.provider_manage),
  validation(validators.createProvider),
  providerController.createProvider,
);

router.get(
  "/getAll",
  auth(endpoint.provider_view),
  providerController.getAllProviders,
);

router.get(
  "/get/:id",
  auth(endpoint.provider_view),
  providerController.getProviderById,
);

router.patch(
  "/update/:id",
  auth(endpoint.provider_manage),
  validation(validators.updateProvider),
  providerController.updateProvider,
);

router.delete(
  "/delete/:id",
  auth(endpoint.provider_manage),
  providerController.deleteProvider,
);

// ── Per-provider resync (placed after /delete/:id intentionally) ─────────────

// POST /api/v1/provider/:id/resync — rebuild a single provider's summary
router.post(
  "/:id/resync",
  auth(endpoint.AdminOnly),
  providerController.resyncProvider,
);

export default router;
