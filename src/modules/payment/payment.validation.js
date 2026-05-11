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
     * directly instead of paying our office.
     *
     * Accounting effects:
     *   1. booking.totalPaid increases by `amount` → customer's debt is cleared.
     *   2. In the provider current-account ledger, `amount` is treated as a
     *      credit: it retires the buy-price debt AND may transfer profit to
     *      the provider as a receivable they hold for us.
     *
     * Must reference a provider that is actually linked to the booking
     * (enforced in the controller via getLinkedProviderIds).
     */
    providerRecipient: Joi.string().hex().length(24).optional().messages({
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

export const editPayment = {
  body: Joi.object({
    amount: Joi.number().positive().messages({
      "number.positive": "Amount must be greater than 0",
    }),
    date: Joi.date().max("now").messages({
      "date.max": "Payment date cannot be in the future",
    }),
    method: Joi.string().valid("cash", "bank_transfer", "check", "other"),
    notes: Joi.string().trim().max(300).allow(""),
    providerRecipient: Joi.string().hex().length(24).allow(null).messages({
      "string.hex": "Invalid provider ID",
      "string.length": "Invalid provider ID",
    }),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    paymentId: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid payment ID",
    }),
  }),
};