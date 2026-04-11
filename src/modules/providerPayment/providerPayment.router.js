import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as providerPaymentController from "./controller/providerPayment.controller.js";
import * as validators from "./providerPayment.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Static routes before dynamic ones.

// GET /api/v1/provider-payment/all — all provider payments (accounting overview)
router.get(
  "/all",
  auth(endpoint.accounting_only),
  providerPaymentController.getAllProviderPayments,
);

// DELETE /api/v1/provider-payment/:paymentId — remove a specific payment
router.delete(
  "/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.deleteProviderPayment),
  providerPaymentController.deleteProviderPayment,
);

// POST /api/v1/provider-payment/:providerId — record a payment to a provider
router.post(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.createProviderPayment),
  providerPaymentController.createProviderPayment,
);

// GET /api/v1/provider-payment/:providerId — list payments for a provider
router.get(
  "/:providerId",
  auth(endpoint.accounting_only),
  validation(validators.getProviderPayments),
  providerPaymentController.getProviderPayments,
);

export default router;
