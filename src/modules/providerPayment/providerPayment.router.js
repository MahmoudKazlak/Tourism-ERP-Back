import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerPaymentController from "./controller/providerPayment.controller.js";
import * as validators from "./providerPayment.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Static routes before dynamic ones

// GET /api/v1/provider-payment/all
router.get(
  "/all",
  auth(endpoint.accounting_only),
  providerPaymentController.getAllProviderPayments,
);

// NEW: PATCH /api/v1/provider-payment/:paymentId  — edit a provider payment
router.patch(
  "/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.editProviderPayment),
  providerPaymentController.editProviderPayment,
);

// DELETE /api/v1/provider-payment/:paymentId
router.delete(
  "/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.deleteProviderPayment),
  providerPaymentController.deleteProviderPayment,
);

// POST /api/v1/provider-payment/:providerId
router.post(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.createProviderPayment),
  providerPaymentController.createProviderPayment,
);

// GET /api/v1/provider-payment/:providerId
router.get(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.getProviderPayments),
  providerPaymentController.getProviderPayments,
);

// NEW: GET /api/v1/provider-payment/payment/:paymentId — single payment lookup
router.get(
  "/payment/:paymentId",
  auth(endpoint.accounting_only),
  providerPaymentController.getProviderPaymentById,
);
export default router;
