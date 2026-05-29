import Joi from "joi";

export const createExpense = {
  body: Joi.object({
    category: Joi.string()
      .valid("rent", "utilities", "salary", "supplies", "maintenance", "other")
      .required()
      .messages({
        "any.only":
          "Category must be one of: rent, utilities, salary, supplies, maintenance, other",
        "any.required": "Category is required",
      }),
    amount: Joi.number().positive().required().messages({
      "number.positive": "Amount must be greater than 0",
      "any.required": "Amount is required",
    }),
    date: Joi.date()
      .max("now")
      .default(() => new Date())
      .messages({
        "date.max": "Date cannot be in the future",
      }),
    description: Joi.string().trim().min(3).max(200).required().messages({
      "string.min": "Description must be at least 3 characters",
      "any.required": "Description is required",
    }),
    method: Joi.string()
      .valid("cash", "bank_transfer", "check", "other")
      .default("cash"),
    reference: Joi.string().trim().max(100).optional().allow(""),
  }),
};

export const updateExpense = {
  body: Joi.object({
    category: Joi.string().valid(
      "rent",
      "utilities",
      "salary",
      "supplies",
      "maintenance",
      "other",
    ),
    amount: Joi.number().positive(),
    date: Joi.date().max("now"),
    description: Joi.string().trim().min(3).max(200),
    method: Joi.string().valid("cash", "bank_transfer", "check", "other"),
    reference: Joi.string().trim().max(100).allow(""),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid expense ID",
      "string.length": "Invalid expense ID",
    }),
  }),
};

export const getExpenses = {
  query: Joi.object({
    category: Joi.string().valid(
      "rent",
      "utilities",
      "salary",
      "supplies",
      "maintenance",
      "other",
    ),
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

// NEW: validate the :id param for GET /expense/:id
export const expenseIdParam = {
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid expense ID",
      "string.length": "Invalid expense ID",
    }),
  }),
};
