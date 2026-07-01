import Joi from "joi";

const objectId = Joi.string().hex().length(24);

export const createProviderCollection = {
  body: Joi.object({
    amount: Joi.number().positive().required().messages({
      "number.positive": "Amount must be greater than 0",
      "any.required": "Amount is required",
    }),
    date: Joi.date()
      .max("now")
      .default(() => new Date())
      .messages({
        "date.max": "Collection date cannot be in the future",
      }),
    method: Joi.string()
      .valid("cash", "bank_transfer", "check", "other")
      .default("cash"),
    notes: Joi.string().trim().max(300).optional().allow(""),
    reference: Joi.string().trim().max(100).optional().allow(""),
    booking: objectId.optional().messages({
      "string.hex": "Invalid booking ID",
      "string.length": "Invalid booking ID",
    }),
  }),
  params: Joi.object({
    providerId: objectId.required().messages({
      "string.hex": "Invalid provider ID",
      "string.length": "Invalid provider ID",
    }),
  }),
};

export const deleteProviderCollection = {
  params: Joi.object({
    collectionId: objectId.required().messages({
      "string.hex": "Invalid collection ID",
    }),
  }),
};

// NEW: edit a provider collection (Admin only) — mirrors editProviderPayment
export const editProviderCollection = {
  body: Joi.object({
    amount: Joi.number().positive().messages({
      "number.positive": "Amount must be greater than 0",
    }),
    date: Joi.date().max("now").messages({
      "date.max": "Collection date cannot be in the future",
    }),
    method: Joi.string().valid("cash", "bank_transfer", "check", "other"),
    notes: Joi.string().trim().max(300).allow(""),
    reference: Joi.string().trim().max(100).allow(""),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    collectionId: objectId.required().messages({
      "string.hex": "Invalid collection ID",
    }),
  }),
};

export const getProviderCollections = {
  params: Joi.object({
    providerId: objectId.required().messages({
      "string.hex": "Invalid provider ID",
    }),
  }),
  query: Joi.object({
    fromDate: Joi.date(),
    toDate: Joi.date().when("fromDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("fromDate")).messages({
        "date.min": "toDate must be after fromDate",
      }),
    }),
    page: Joi.number().integer().min(1).default(1),
    size: Joi.number().integer().min(1).max(100).default(10),
  }),
};