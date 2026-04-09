import Joi from "joi";

// الـ password pattern القديم كان خاطئ: ^[A-Z][a-z]{2,6}$ = بس 3-7 حروف مثل "Abc"
// الـ pattern الجديد: 6+ حروف، حرف كبير، حرف صغير، رقم
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
