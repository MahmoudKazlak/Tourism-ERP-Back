import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as statementController from "./controller/statement.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// كشف حساب مورد
// GET /api/v1/statement/provider/:providerId?fromDate=&toDate=
router.get(
  "/provider/:providerId",
  auth(endpoint.accounting_only),
  statementController.getProviderStatement,
);

// كشف حساب زبون
// GET /api/v1/statement/customer/:customerName?fromDate=&toDate=
router.get(
  "/customer/:customerName",
  auth(endpoint.accounting_only),
  statementController.getCustomerStatement,
);

export default router;
