import Joi from "joi";
import { SERVICE_TYPE_KEYS } from "../../config/serviceTypes.js";

const objectId = Joi.string().hex().length(24);

const customerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    "any.required": "Customer name is required",
    "string.min": "Customer name must be at least 2 characters",
  }),
  ageType: Joi.string().valid("adult", "child", "infant").default("adult"),
});

/**
 * Generic service schema.
 *
 * Joi validates structure and the serviceType enum.
 * Type-specific field requirements (e.g., checkIn/checkOut for accommodation)
 * are enforced in the controller via validateServiceDetails(), which can
 * give richer error messages and runs after the provider existence check.
 */
const serviceSchema = Joi.object({
  serviceType: Joi.string()
    .valid(...SERVICE_TYPE_KEYS)
    .required()
    .messages({
      "any.required": "serviceType is required",
      "any.only": `serviceType must be one of: ${SERVICE_TYPE_KEYS.join(", ")}`,
    }),
  provider: objectId.required().messages({
    "any.required": "Provider ID is required for each service",
    "string.hex": "Invalid provider ID format",
    "string.length": "Invalid provider ID length",
  }),
  buy: Joi.number().min(0).default(0),
  sell: Joi.number().min(0).default(0),
  // details holds all type-specific fields; unknown keys are allowed
  details: Joi.object().unknown(true).default({}),
});

const totalPaxSchema = Joi.object({
  adults: Joi.number().integer().min(0).default(0),
  kids: Joi.number().integer().min(0).default(0),
});

// ── Route schemas ─────────────────────────────────────────────────────────────

export const createBooking = {
  body: Joi.object({
    provider: objectId.required().messages({
      "any.required": "Main provider is required",
      "string.hex": "Invalid provider ID format",
      "string.length": "Invalid provider ID length",
    }),
    status: Joi.string()
      .valid("pending", "confirmed", "cancelled", "completed")
      .default("pending"),
    customers: Joi.array().items(customerSchema).min(1).required().messages({
      "any.required": "At least one customer is required",
      "array.min": "At least one customer is required",
    }),
    services: Joi.array().items(serviceSchema).default([]),
    totalPax: totalPaxSchema.optional(),
  }),
};

export const updateBooking = {
  body: Joi.object({
    status: Joi.string().valid(
      "pending",
      "confirmed",
      "cancelled",
      "completed",
    ),
    customers: Joi.array().items(customerSchema).min(1),
    services: Joi.array().items(serviceSchema),
    totalPax: totalPaxSchema,
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: objectId.required().messages({
      "string.hex": "Invalid booking ID",
      "string.length": "Invalid booking ID",
    }),
  }),
};

export const addService = {
  body: serviceSchema,
  params: Joi.object({
    id: objectId.required().messages({ "string.hex": "Invalid booking ID" }),
  }),
};

export const removeService = {
  body: Joi.object({
    serviceId: objectId.required().messages({
      "string.hex": "Invalid service ID",
    }),
  }),
  params: Joi.object({
    id: objectId.required().messages({ "string.hex": "Invalid booking ID" }),
  }),
};

export const bookingIdParam = {
  params: Joi.object({
    id: objectId.required().messages({ "string.hex": "Invalid booking ID" }),
  }),
};

export const getAllBookingsQuery = {
  query: Joi.object({
    bookingID: Joi.number().integer().min(1),
    provider: objectId,
    serviceType: Joi.string().valid(...SERVICE_TYPE_KEYS),
    status: Joi.string().valid(
      "pending",
      "confirmed",
      "cancelled",
      "completed",
    ),
    paymentStatus: Joi.string().valid("unpaid", "partial", "paid"),
    customerName: Joi.string().trim().min(1).max(100),
    fromDate: Joi.date(),
    toDate: Joi.date().when("fromDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("fromDate")).messages({
        "date.min": "toDate must be after fromDate",
      }),
    }),
    minAmount: Joi.number().min(0),
    maxAmount: Joi.number().min(0),
    sortBy: Joi.string().valid(
      "createdAt",
      "bookingID",
      "totalToPay",
      "totalProfit",
    ),
    sortOrder: Joi.string().valid("asc", "desc"),
    page: Joi.number().integer().min(1).default(1),
    size: Joi.number().integer().min(1).max(100).default(10),
  }),
};
