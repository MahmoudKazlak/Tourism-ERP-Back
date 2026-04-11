import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as statementController from "./controller/statement.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// GET /api/v1/statement/provider/:providerId?fromDate=&toDate=
router.get(
  "/provider/:providerId",
  auth(endpoint.accounting_only),
  statementController.getProviderStatement,
);

// GET /api/v1/statement/customer/:customerName?fromDate=&toDate=&page=1&size=10
router.get(
  "/customer/:customerName",
  auth(endpoint.accounting_only),
  statementController.getCustomerStatement,
);

export default router;
