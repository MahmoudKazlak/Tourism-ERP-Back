import Joi from "joi";
import { SERVICE_TYPE_KEYS } from "../../config/serviceTypes.js";

const detailFieldSchema = Joi.object({
  key: Joi.string()
    .trim()
    .pattern(/^[a-z][a-zA-Z0-9]*$/)
    .required()
    .messages({
      "string.pattern.base":
        "Field key must be camelCase (e.g. flightNumber)",
    }),
  label: Joi.string().trim().min(1).max(80).required(),
  fieldType: Joi.string().valid("text", "date", "number").default("text"),
  required: Joi.boolean().default(false),
});

const durationFieldsSchema = Joi.object({
  from: Joi.string().trim().required(),
  to: Joi.string().trim().required(),
  unit: Joi.string().trim().max(20).default("days"),
});

const officeKeySchema = Joi.string()
  .trim()
  .lowercase()
  .pattern(/^[a-z][a-zA-Z0-9]*$/)
  .min(2)
  .max(40)
  .invalid(...SERVICE_TYPE_KEYS)
  .messages({
    "any.invalid": "This key is reserved for a built-in service type",
    "string.pattern.base":
      "Key must be camelCase (e.g. airline, flightBooking)",
  });

export const createOfficeServiceType = {
  body: Joi.object({
    key: officeKeySchema.required(),
    label: Joi.string().trim().min(2).max(100).required(),
    voucherPrefix: Joi.string()
      .trim()
      .uppercase()
      .min(2)
      .max(4)
      .required()
      .messages({
        "string.min": "Voucher prefix must be 2–4 characters",
      }),
    durationFields: durationFieldsSchema.optional(),
    detailFields: Joi.array().items(detailFieldSchema).max(12).default([]),
  }),
};

export const updateOfficeServiceType = {
  body: Joi.object({
    label: Joi.string().trim().min(2).max(100),
    voucherPrefix: Joi.string().trim().uppercase().min(2).max(4),
    durationFields: durationFieldsSchema.allow(null),
    detailFields: Joi.array().items(detailFieldSchema).max(12),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

export const officeServiceTypeIdParam = {
  params: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};
