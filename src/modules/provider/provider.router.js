import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as providerController from "./controller/provider.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

router.post(
  "/create",
  auth(endpoint.provider_manage),
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
  providerController.updateProvider,
);
router.delete(
  "/delete/:id",
  auth(endpoint.provider_manage),
  providerController.deleteProvider,
);

export default router;
