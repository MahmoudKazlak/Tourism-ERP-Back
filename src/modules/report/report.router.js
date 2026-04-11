import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as reportController from "./controller/report.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// All report routes are restricted to accounting staff and admins.
// They return CSV file downloads except for P&L which returns JSON.

// GET /api/v1/report/bookings?fromDate=&toDate=&status=&paymentStatus=
router.get(
  "/bookings",
  auth(endpoint.accounting_only),
  reportController.exportBookings,
);

// GET /api/v1/report/payments?fromDate=&toDate=&method=
router.get(
  "/payments",
  auth(endpoint.accounting_only),
  reportController.exportPayments,
);

// GET /api/v1/report/expenses?fromDate=&toDate=&category=
router.get(
  "/expenses",
  auth(endpoint.accounting_only),
  reportController.exportExpenses,
);

// GET /api/v1/report/provider-payments?fromDate=&toDate=
router.get(
  "/provider-payments",
  auth(endpoint.accounting_only),
  reportController.exportProviderPayments,
);

// GET /api/v1/report/pnl?fromDate=&toDate=
// Profit & Loss summary JSON — useful for dashboard or further processing.
router.get(
  "/pnl",
  auth(endpoint.accounting_only),
  reportController.getProfitLoss,
);

export default router;
