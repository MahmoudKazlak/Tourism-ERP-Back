import { asyncHandler } from "../../../middleware/asyncHandler.js";
import providerModel from "../../../../DB/model/provider.model.js";
import logModel from "../../../../DB/model/log.model.js";
import mongoose from "mongoose";
import { pagination } from "../../../services/pagination.js";

export const createProvider = asyncHandler(async (req, res, next) => {
  const { name, type, phone, address } = req.body;

  const isExist = await providerModel.findOne({ name });
  if (isExist)
    return next(new Error("Provider name already exists", { cause: 400 }));

  const provider = await providerModel.create({
    name,
    type,
    phone,
    address,
    currentSequence: 0,
  });

  await logModel.create({
    user: req.user._id,
    action: "CREATE_PROVIDER",
    details: { providerId: provider._id, providerName: provider.name },
  });

  res.status(201).json({
    success: true,
    message: "Provider created successfully",
    data: { provider },
    errors: null,
  });
});

export const deleteProvider = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // FIX [4]: The original check only covered provider (main) and
  // accommodations.hotel, silently allowing deletion of providers that
  // were only used in carRentals or tripsWithDrivers.
  const hasBookings = await mongoose.model("Booking").findOne({
    $or: [
      { provider: id },
      { "accommodations.hotel": id },
      { "carRentals.provider": id },
      { "carWithDriver.provider": id },
    ],
  });

  if (hasBookings) {
    return next(
      new Error(
        "Cannot delete provider with active bookings. " +
          "Remove all linked bookings first.",
        { cause: 400 },
      ),
    );
  }

  const provider = await providerModel.findByIdAndDelete(id);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  await logModel.create({
    user: req.user._id,
    action: "DELETE_PROVIDER",
    details: { providerId: id, providerName: provider.name },
  });

  res.status(200).json({
    success: true,
    message: "Provider deleted successfully",
    data: null,
    errors: null,
  });
});

export const getAllProviders = asyncHandler(async (req, res, next) => {
  const { type, page, size } = req.query;

  const query = {};
  if (type) query.type = type;

  const { limit, skip } = pagination(page, size || 50);

  const [providers, totalCount] = await Promise.all([
    providerModel.find(query).sort({ name: 1 }).limit(limit).skip(skip),
    providerModel.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page: parseInt(page) || 1,
      count: providers.length,
      providers,
    },
    errors: null,
  });
});

export const getProviderById = asyncHandler(async (req, res, next) => {
  const provider = await providerModel.findById(req.params.id);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { provider },
    errors: null,
  });
});

export const updateProvider = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const update = {};

  for (const [key, value] of Object.entries(req.body)) {
    // Prevent overwriting internal counters managed by the booking logic.
    if (
      key !== "_id" &&
      key !== "currentSequence" &&
      key !== "totalBookings" &&
      value != null
    ) {
      update[key] = value;
    }
  }

  const provider = await providerModel.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true, runValidators: true },
  );
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_PROVIDER",
    details: { providerId: id, updatedFields: Object.keys(req.body) },
  });

  res.status(200).json({
    success: true,
    message: "Provider updated successfully",
    data: { provider },
    errors: null,
  });
});
