import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerController from "./controller/provider.controller.js";
import * as validators from "./provider.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// FIX [6]: Added Joi validation middleware to create and update routes.
// Previously these routes accepted any payload without schema validation.
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

export default router;
