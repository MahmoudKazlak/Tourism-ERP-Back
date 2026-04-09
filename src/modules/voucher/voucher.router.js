import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as voucherController from "./controller/voucher.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Service Voucher — ورقة للمورد (بدون أسعار)
// GET /api/v1/voucher/service/:bookingId?serviceType=accommodations&serviceIndex=0
router.get(
  "/service/:bookingId",
  auth(endpoint.booking_view),
  voucherController.getServiceVoucher,
);

// Invoice — فاتورة كاملة للزبون بالأسعار
// GET /api/v1/voucher/invoice/:bookingId
router.get(
  "/invoice/:bookingId",
  auth(endpoint.booking_view),
  voucherController.getInvoice,
);

// Receipt — سند قبض لدفعة محددة
// GET /api/v1/voucher/receipt/:paymentId
router.get(
  "/receipt/:paymentId",
  auth(endpoint.booking_view),
  voucherController.getReceipt,
);

export default router;
