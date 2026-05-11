import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as paymentController from "./controller/payment.controller.js";
import * as validators from "./payment.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// ── Static routes first ───────────────────────────────────────────────────────

router.get(
  "/payments/all",
  auth(endpoint.accounting_only),
  paymentController.getAllPayments,
);

// Admin can edit any payment field (amount, date, method, notes, providerRecipient)
router.patch(
  "/payments/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.editPayment),
  paymentController.editPayment,
);

router.delete(
  "/payments/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.deletePayment),
  paymentController.deletePayment,
);

// ── Dynamic routes after ──────────────────────────────────────────────────────

router.post(
  "/:id/payments",
  auth(endpoint.booking_manage),
  validation(validators.addPayment),
  paymentController.addPayment,
);

router.get(
  "/:id/payments",
  auth(endpoint.booking_view),
  paymentController.getPaymentsByBooking,
);

export default router;
