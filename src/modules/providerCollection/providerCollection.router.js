import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerCollectionController from "./controller/providerCollection.controller.js";
import * as validators from "./providerCollection.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Static routes before dynamic ones.

// GET /api/v1/provider-collection/all — overview for accounting
router.get(
  "/all",
  auth(endpoint.accounting_only),
  providerCollectionController.getAllProviderCollections,
);

// NEW: GET /api/v1/provider-collection/collection/:collectionId — single lookup
router.get(
  "/collection/:collectionId",
  auth(endpoint.accounting_only),
  providerCollectionController.getProviderCollectionById,
);

// Case 8 / Gap 2: server-generated PDF receipt
router.get(
  "/collection/:collectionId/receipt",
  auth(endpoint.accounting_only),
  providerCollectionController.downloadProviderCollectionReceipt,
);

// PATCH /api/v1/provider-collection/:collectionId — Admin only
router.patch(
  "/:collectionId",
  auth(endpoint.AdminOnly),
  validation(validators.editProviderCollection),
  providerCollectionController.editProviderCollection,
);

// DELETE /api/v1/provider-collection/:collectionId — Admin only
router.delete(
  "/:collectionId",
  auth(endpoint.AdminOnly), 
  validation(validators.deleteProviderCollection),
  providerCollectionController.deleteProviderCollection,
);

// POST /api/v1/provider-collection/:providerId — record a recovery from a provider
router.post(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.createProviderCollection),
  providerCollectionController.createProviderCollection,
);

// GET /api/v1/provider-collection/:providerId — list collections for a provider
router.get(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.getProviderCollections),
  providerCollectionController.getProviderCollections,
);

export default router;