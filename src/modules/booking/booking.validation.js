import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const customerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    "any.required": "Customer name is required",
    "string.min": "Customer name must be at least 2 characters",
  }),
  ageType: Joi.string().valid("adult", "child", "infant").default("adult"),
});

const accommodationSchema = Joi.object({
  hotel: objectId.required().messages({
    "any.required": "Hotel ID is required",
    "string.hex": "Invalid hotel ID format",
    "string.length": "Invalid hotel ID length",
  }),
  checkIn: Joi.date().required().messages({
    "any.required": "Check-in date is required",
  }),
  checkOut: Joi.date().greater(Joi.ref("checkIn")).required().messages({
    "any.required": "Check-out date is required",
    "date.greater": "Check-out must be after check-in",
  }),
  room: Joi.string().trim().max(50).optional().allow(""),
  roomType: Joi.string().trim().max(50).optional().allow(""),
  board: Joi.string().trim().max(50).optional().allow(""),
  buy: Joi.number().min(0).default(0),
  sell: Joi.number().min(0).default(0),
});

const carRentalSchema = Joi.object({
  provider: objectId.required().messages({
    "any.required": "Provider ID is required",
    "string.hex": "Invalid provider ID format",
    "string.length": "Invalid provider ID length",
  }),
  brand: Joi.string().trim().max(100).optional().allow(""),
  pickUp: Joi.date().required().messages({
    "any.required": "Pick-up date is required",
  }),
  dropOff: Joi.date().greater(Joi.ref("pickUp")).required().messages({
    "any.required": "Drop-off date is required",
    "date.greater": "Drop-off must be after pick-up",
  }),
  buy: Joi.number().min(0).default(0),
  sell: Joi.number().min(0).default(0),
});

// Renamed from tripSchema / tripsWithDrivers
const carWithDriverSchema = Joi.object({
  provider: objectId.required().messages({
    "any.required": "Provider ID is required",
    "string.hex": "Invalid provider ID format",
    "string.length": "Invalid provider ID length",
  }),
  driverName: Joi.string().trim().max(100).optional().allow(""),
  brand: Joi.string().trim().max(100).optional().allow(""),
  buy: Joi.number().min(0).default(0),
  sell: Joi.number().min(0).default(0),
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
    accommodations: Joi.array().items(accommodationSchema).default([]),
    carRentals: Joi.array().items(carRentalSchema).default([]),
    carWithDriver: Joi.array().items(carWithDriverSchema).default([]), // renamed
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
    accommodations: Joi.array().items(accommodationSchema),
    carRentals: Joi.array().items(carRentalSchema),
    carWithDriver: Joi.array().items(carWithDriverSchema), // renamed
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
  body: Joi.object({
    serviceType: Joi.string()
      .valid("accommodations", "carRentals", "carWithDriver") // renamed
      .required()
      .messages({
        "any.required": "serviceType is required",
        "any.only":
          "serviceType must be accommodations, carRentals, or carWithDriver",
      }),
    serviceData: Joi.object().required().messages({
      "any.required": "serviceData is required",
    }),
  }),
  params: Joi.object({
    id: objectId.required().messages({ "string.hex": "Invalid booking ID" }),
  }),
};

export const removeService = {
  body: Joi.object({
    serviceType: Joi.string()
      .valid("accommodations", "carRentals", "carWithDriver") // renamed
      .required(),
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
