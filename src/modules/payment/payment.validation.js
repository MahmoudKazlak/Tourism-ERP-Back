import Joi from "joi";

export const addPayment = {
  body: Joi.object({
    amount: Joi.number().positive().required().messages({
      "number.positive": "Amount must be greater than 0",
      "number.base": "Amount must be a number",
      "any.required": "Amount is required",
    }),
    date: Joi.date().max("now").optional().messages({
      "date.max": "Payment date cannot be in the future",
    }),
    method: Joi.string()
      .valid("cash", "bank_transfer", "check", "other")
      .default("cash"),
    notes: Joi.string().trim().max(300).optional().allow(""),
    /**
     * Optional. When provided, indicates the customer paid this provider
     * directly. The booking is still credited (customer settled), but the
     * provider current-account balance is also reduced by this amount.
     */
    providerRecipient: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid provider ID",
      "string.length": "Invalid provider ID",
    }),
  }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid booking ID",
      "string.length": "Invalid booking ID",
    }),
  }),
};

export const deletePayment = {
  params: Joi.object({
    paymentId: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid payment ID",
    }),
  }),
};
