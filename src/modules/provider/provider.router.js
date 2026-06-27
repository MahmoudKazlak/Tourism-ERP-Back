import { Router } from "express";
import { auth }       from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerController from "./controller/provider.controller.js";
import * as validators         from "./provider.validation.js";
import { endpoint }            from "../indexEndpoint.js";

const router = Router();

// ── Static routes MUST come before /:id dynamic routes ───────────────────────
// Express matches routes in registration order. Any static segment placed after
// /:id will be swallowed by the param matcher (e.g. "sync-failures" would be
// treated as an id value if registered after "/:id/resync").

// POST /api/v1/provider/resync-all
router.post(
  "/resync-all",
  auth(endpoint.AdminOnly),
  providerController.resyncAllProviders,
);

// GET /api/v1/provider/sync-failures
// Returns provider summary drift events (Phase 4 SyncFailure model).
// ?resolved=false (default) | ?resolved=true | ?resolved=all
// ?providerId=<ObjectId>  to filter by provider
router.get(
  "/sync-failures",
  auth(endpoint.AdminOnly),
  providerController.getSyncFailures,
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

// ── Dynamic :id routes LAST ───────────────────────────────────────────────────

// POST /api/v1/provider/:id/resync
router.post(
  "/:id/resync",
  auth(endpoint.AdminOnly),
  providerController.resyncProvider,
);

export default router;
