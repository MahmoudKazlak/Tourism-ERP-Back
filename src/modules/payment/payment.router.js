import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as paymentController from "./controller/payment.controller.js";
import * as validators from "./payment.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Static routes أولاً
router.get(
  "/payments/all",
  auth(endpoint.accounting_only),
  paymentController.getAllPayments,
);

router.delete(
  "/payments/:paymentId",
  auth(endpoint.AdminOnly),
  validation(validators.deletePayment),
  paymentController.deletePayment,
);

// Dynamic routes بعدها
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
