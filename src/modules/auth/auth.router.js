import { Router } from "express";
import * as authController from "./controller/auth.controller.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validation } from "../../middleware/validation.js";
import * as validators from "./auth.validation.js";
import { auth } from "../../middleware/auth.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// تسجيل الدخول
router.post("/signin", asyncHandler(authController.signIn));

// نسيان كلمة المرور
router.post("/sendCode", asyncHandler(authController.sendCode));
router.post("/forgotPassword", asyncHandler(authController.forgotPassword));

// إدارة المستخدمين (Admin فقط)
//create user
router.post(
  "/createUser",
  auth(endpoint.AdminOnly),
  validation(validators.createUser),
  asyncHandler(authController.createUser),
);
//update user
router.patch(
  "/update/:id",
  auth(endpoint.AdminOnly),
  asyncHandler(authController.updateUser),
);
router.get(
  "/",
  auth(endpoint.AdminOnly),
  asyncHandler(authController.getAllUsers),
);

export default router;
