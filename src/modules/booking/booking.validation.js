import Joi from "joi";
import { getMergedServiceTypeKeys } from "../../services/serviceTypeRegistry.js";

const objectId = Joi.string().hex().length(24);

const customerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    "any.required": "Customer name is required",
    "string.min": "Customer name must be at least 2 characters",
  }),
  ageType: Joi.string().valid("adult", "child", "infant").default("adult"),
});

/**
 * Custom Joi validator for serviceType.
 *
 * Why .custom() instead of .valid(...keys):
 *   .valid(...keys) is evaluated ONCE at module load — it freezes the list of
 *   known types at startup. Any custom type added at runtime updates the
 *   in-memory registry but the frozen Joi schema still rejects it.
 *
 *   .custom() runs the check on every request, reading the current merged
 *   registry each time, so newly added office service types are accepted
 *   immediately without a server restart.
 */
const serviceTypeValidator = Joi.string()
  .trim()
  .min(1)
  .custom((value, helpers) => {
    if (!getMergedServiceTypeKeys().includes(value)) {
      const validKeys = getMergedServiceTypeKeys().join(", ");
      return helpers.error("serviceType.invalid", { validKeys });
    }
    return value;
  })
  .required()
  .messages({
    "serviceType.invalid":
      "Invalid serviceType '{{#value}}'. Must be one of: {{#validKeys}}",
    "any.required": "serviceType is required",
    "string.empty": "serviceType is required",
  });

/**
 * Same dynamic check for the ?serviceType query filter.
 * Optional — accepts undefined (no filter).
 */
const serviceTypeQueryValidator = Joi.string()
  .trim()
  .min(1)
  .custom((value, helpers) => {
    if (!getMergedServiceTypeKeys().includes(value)) {
      return helpers.error("serviceType.invalid", {
        validKeys: getMergedServiceTypeKeys().join(", "),
      });
    }
    return value;
  })
  .optional()
  .messages({
    "serviceType.invalid":
      "Invalid serviceType filter '{{#value}}'. Must be one of: {{#validKeys}}",
  });

const serviceSchema = Joi.object({
  serviceType: serviceTypeValidator,
  provider: objectId.required().messages({
    "any.required": "Provider ID is required for each service",
    "string.hex": "Invalid provider ID format",
    "string.length": "Invalid provider ID length",
  }),
  buy:  Joi.number().min(0).default(0),
  sell: Joi.number().min(0).default(0),
  // details holds all type-specific fields (checkIn, checkOut, brand, etc.)
  details: Joi.object().unknown(true).default({}),
  // notes: free-text field available on every service, never required.
  // Allows staff to record context, special requests, or internal remarks.
  notes: Joi.string().trim().max(1000).allow("").optional().default(""),
});

const totalPaxSchema = Joi.object({
  adults: Joi.number().integer().min(0).default(0),
  kids:   Joi.number().integer().min(0).default(0),
});

// ── Route schemas ─────────────────────────────────────────────────────────────

// NEW
export const createBooking = {
  body: Joi.object({
    provider: objectId.required().messages({
      "any.required": "Main provider is required",
      "string.hex":   "Invalid provider ID format",
      "string.length":"Invalid provider ID length",
    }),
    status: Joi.string()
      .valid("pending", "confirmed", "cancelled", "completed")
      .default("pending"),
    bookingType: Joi.string()
      .valid("agency", "customer")
      .default("customer")
      .messages({
        "any.only": "bookingType must be 'agency' or 'customer'",
      }),
    providerProfit: Joi.number().min(0).when("bookingType", {
      is: "agency",
      then: Joi.number().min(0).default(0),
      otherwise: Joi.number().valid(0).default(0).messages({
        "any.only": "providerProfit is only allowed for agency bookings",
      }),
    }),
    officeProfit: Joi.number().min(0).when("bookingType", {
      is: "agency",
      then: Joi.number().min(0).default(0),
      otherwise: Joi.number().valid(0).default(0).messages({
        "any.only": "officeProfit is only allowed for agency bookings",
      }),
    }),
    customers: Joi.array().items(customerSchema).min(1).required().messages({
      "any.required": "At least one customer is required",
      "array.min":    "At least one customer is required",
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
    // NEW
    provider: objectId.messages({
      "string.hex": "Invalid provider ID",
      "string.length": "Invalid provider ID",
    }),
    // bookingType is immutable — intentionally NOT accepted here.
    // Both are gated at the controller level (locked once paymentStatus === "paid",
    // and rejected outright for non-agency bookings).
    providerProfit: Joi.number().min(0),
    officeProfit: Joi.number().min(0),
    customers: Joi.array().items(customerSchema).min(1),
    services: Joi.array().items(serviceSchema),
    totalPax: totalPaxSchema,
    expectedVersion: Joi.number().integer().min(0),
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
    serviceType: serviceTypeQueryValidator,
    status: Joi.string().valid(
      "pending",
      "confirmed",
      "cancelled",
      "completed",
    ),
    paymentStatus: Joi.string().valid("unpaid", "partial", "paid"),
    customerName: Joi.string().trim().min(1).max(100),
    // Case 8: general search across bookingID / referenceCode / customer
    // name — powers BookingLinkPicker on the ProviderPayment/ProviderCollection
    // creation forms. Independent of the more specific customerName filter above.
    q: Joi.string().trim().min(1).max(100),
    bookingType: Joi.string().valid("agency", "customer"),
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
export const editService = {
  body: Joi.object({
    buy: Joi.number().min(0),
    sell: Joi.number().min(0),
    details: Joi.object().unknown(true),
    notes: Joi.string().trim().max(1000).allow(""),
    expectedVersion: Joi.number().integer().min(0),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: objectId.required().messages({
      "string.hex": "Invalid booking ID",
      "string.length": "Invalid booking ID",
    }),
    serviceId: objectId.required().messages({
      "string.hex": "Invalid service ID",
      "string.length": "Invalid service ID",
    }),
  }),
};
