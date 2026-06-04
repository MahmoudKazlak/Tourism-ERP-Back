import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import { endpoint } from "../indexEndpoint.js";
import * as serviceTypeController from "./controller/serviceType.controller.js";
import * as validators from "./serviceType.validation.js";

const router = Router();

router.get(
  "/",
  auth(endpoint.All),
  serviceTypeController.getServiceTypes,
);

router.post(
  "/",
  auth(endpoint.AdminOnly),
  validation(validators.createOfficeServiceType),
  serviceTypeController.createOfficeServiceType,
);

router.patch(
  "/:id",
  auth(endpoint.AdminOnly),
  validation(validators.updateOfficeServiceType),
  serviceTypeController.updateOfficeServiceType,
);

router.delete(
  "/:id",
  auth(endpoint.AdminOnly),
  validation(validators.officeServiceTypeIdParam),
  serviceTypeController.deleteOfficeServiceType,
);

export default router;
