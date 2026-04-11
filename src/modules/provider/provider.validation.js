import Joi from "joi";

export const createProvider = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required().messages({
      "any.required": "Provider name is required",
      "string.min": "Name must be at least 2 characters",
    }),
    type: Joi.string()
      .valid("hotel", "car_rental", "driver_company", "tourism")
      .required()
      .messages({
        "any.required": "Provider type is required",
        "any.only":
          "Type must be hotel, car_rental, driver_company, or tourism",
      }),
    phone: Joi.string()
      .pattern(/^\+?[\d\s\-().]{7,20}$/)
      .optional()
      .allow("")
      .messages({
        "string.pattern.base": "Invalid phone number format",
      }),
    address: Joi.string().trim().max(200).optional().allow(""),
  }),
};

export const updateProvider = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).messages({
      "string.min": "Name must be at least 2 characters",
    }),
    type: Joi.string()
      .valid("hotel", "car_rental", "driver_company", "tourism")
      .messages({
        "any.only":
          "Type must be hotel, car_rental, driver_company, or tourism",
      }),
    phone: Joi.string()
      .pattern(/^\+?[\d\s\-().]{7,20}$/)
      .allow("")
      .messages({
        "string.pattern.base": "Invalid phone number format",
      }),
    address: Joi.string().trim().max(200).allow(""),
  })
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required().messages({
      "string.hex": "Invalid provider ID",
      "string.length": "Invalid provider ID",
    }),
  }),
};
