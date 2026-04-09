import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as expenseController from "./controller/expense.controller.js";
import * as validators from "./expense.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// إغلاق الصندوق اليومي — static قبل dynamic
// GET /api/v1/expense/cash-closing?date=2024-01-15
router.get(
  "/cash-closing",
  auth(endpoint.accounting_only),
  expenseController.getDailyCashClosing,
);

// جلب كل المصاريف مع فلترة
// GET /api/v1/expense?category=rent&fromDate=&toDate=&page=1&size=10
router.get(
  "/",
  auth(endpoint.accounting_only),
  validation(validators.getExpenses),
  expenseController.getAllExpenses,
);

// إضافة مصروف
// POST /api/v1/expense
router.post(
  "/",
  auth(endpoint.accounting_only),
  validation(validators.createExpense),
  expenseController.createExpense,
);

// تعديل مصروف
// PATCH /api/v1/expense/:id
router.patch(
  "/:id",
  auth(endpoint.AdminOnly),
  validation(validators.updateExpense),
  expenseController.updateExpense,
);

// حذف مصروف
// DELETE /api/v1/expense/:id
router.delete(
  "/:id",
  auth(endpoint.AdminOnly),
  expenseController.deleteExpense,
);

export default router;
