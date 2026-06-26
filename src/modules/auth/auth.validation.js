import Joi from "joi";
import { ROLES, ALL_ROLES } from "../../config/roles.js";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;
const passwordMessage =
  "Password must be at least 6 characters with uppercase, lowercase, and a number";

// Role error message is derived from ALL_ROLES so it stays accurate
// when a new role is added to the config.
const roleValidMessage = `Role must be one of: ${ALL_ROLES.join(", ")}`;

export const createUser = {
  body: Joi.object()
    .required()
    .keys({
      userName: Joi.string().min(3).max(25).required().messages({
        "any.required": "Username is required",
        "string.min":   "Username must be at least 3 characters",
      }),
      email: Joi.string().email().required().messages({
        "any.required": "Email is required",
      }),
      password: Joi.string().pattern(passwordPattern).required().messages({
        "any.required":        "Password is required",
        "string.pattern.base": passwordMessage,
      }),
      cPassword: Joi.string().valid(Joi.ref("password")).required().messages({
        "any.only": "Passwords do not match",
      }),
      // Joi.valid(...ALL_ROLES) expands to .valid("admin", "booking_staff", "accounting_staff").
      // Adding a role to ROLES automatically updates validation — no changes needed here.
      role: Joi.string().valid(...ALL_ROLES).required().messages({
        "any.only":    roleValidMessage,
        "any.required": "Role is required",
      }),
    }),
};

export const updateUser = {
  body: Joi.object({
    userName: Joi.string().min(3).max(25).messages({
      "string.min": "Username must be at least 3 characters",
    }),
    email: Joi.string().email().messages({
      "string.email": "Must be a valid email address",
    }),
    phone: Joi.string()
      .pattern(/^\+?[\d\s\-().]{7,20}$/)
      .allow("")
      .messages({
        "string.pattern.base": "Invalid phone number format",
      }),
    role: Joi.string().valid(...ALL_ROLES).messages({
      "any.only": roleValidMessage,
    }),
    blocked:  Joi.boolean(),
    password: Joi.string().pattern(passwordPattern).messages({
      "string.pattern.base": passwordMessage,
    }),
    cPassword: Joi.string()
      .valid(Joi.ref("password"))
      .when("password", {
        is:        Joi.exist(),
        then:      Joi.required(),
        otherwise: Joi.forbidden(),
      })
      .messages({
        "any.only":    "Passwords do not match",
        "any.required": "Confirm password is required when changing password",
      }),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex":    "Invalid user ID",
      "string.length": "Invalid user ID",
    }),
  }),
};

// ── Self-service profile update ───────────────────────────────────────────────
// Non-admin users may only change safe personal fields.
// role, blocked, and email are intentionally excluded.
export const updateSelf = {
  body: Joi.object({
    userName: Joi.string().min(3).max(25).messages({
      "string.min": "Username must be at least 3 characters",
    }),
    phone: Joi.string()
      .pattern(/^\+?[\d\s\-().]{7,20}$/)
      .allow("")
      .messages({
        "string.pattern.base": "Invalid phone number format",
      }),
    password: Joi.string().pattern(passwordPattern).messages({
      "string.pattern.base": passwordMessage,
    }),
    cPassword: Joi.string()
      .valid(Joi.ref("password"))
      .when("password", {
        is:        Joi.exist(),
        then:      Joi.required(),
        otherwise: Joi.forbidden(),
      })
      .messages({
        "any.only":    "Passwords do not match",
        "any.required": "Confirm password is required when changing password",
      }),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
};

// ── User ID param only ────────────────────────────────────────────────────────
export const userIdParam = {
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex":    "Invalid user ID",
      "string.length": "Invalid user ID",
    }),
  }),
};
