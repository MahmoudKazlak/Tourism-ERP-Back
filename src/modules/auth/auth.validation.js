import Joi from "joi";

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;
const passwordMessage =
  "Password must be at least 6 characters with uppercase, lowercase, and a number";

export const createUser = {
  body: Joi.object()
    .required()
    .keys({
      userName: Joi.string().min(3).max(25).required().messages({
        "any.required": "Username is required",
        "string.min": "Username must be at least 3 characters",
      }),
      email: Joi.string().email().required().messages({
        "any.required": "Email is required",
      }),
      password: Joi.string().pattern(passwordPattern).required().messages({
        "any.required": "Password is required",
        "string.pattern.base": passwordMessage,
      }),
      cPassword: Joi.string().valid(Joi.ref("password")).required().messages({
        "any.only": "Passwords do not match",
      }),
      role: Joi.string()
        .valid("admin", "booking_staff", "accounting_staff")
        .required()
        .messages({
          "any.only": "Role must be admin, booking_staff, or accounting_staff",
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
    role: Joi.string()
      .valid("admin", "booking_staff", "accounting_staff")
      .messages({
        "any.only": "Role must be admin, booking_staff, or accounting_staff",
      }),
    blocked: Joi.boolean(),
    password: Joi.string().pattern(passwordPattern).messages({
      "string.pattern.base": passwordMessage,
    }),
    cPassword: Joi.string()
      .valid(Joi.ref("password"))
      .when("password", {
        is: Joi.exist(),
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      })
      .messages({
        "any.only": "Passwords do not match",
        "any.required": "Confirm password is required when changing password",
      }),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid user ID",
      "string.length": "Invalid user ID",
    }),
  }),
};

// ── NEW: self-service update (non-admin users updating their own profile) ────
// Allows only safe personal fields — never role, blocked, or email.
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
        is: Joi.exist(),
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      })
      .messages({
        "any.only": "Passwords do not match",
        "any.required": "Confirm password is required when changing password",
      }),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
};

// ── NEW: user ID param only ───────────────────────────────────────────────────
export const userIdParam = {
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid user ID",
      "string.length": "Invalid user ID",
    }),
  }),
};
