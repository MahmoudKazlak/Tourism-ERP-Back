import { asyncHandler } from "../../../middleware/asyncHandler.js";
import providerModel from "../../../../DB/model/provider.model.js";
import logModel from "../../../../DB/model/log.model.js";
import mongoose from "mongoose";
import { pagination } from "../../../services/pagination.js";
import { resyncProviderSummary } from "../../../services/providerSummaryService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Create provider
// POST /api/v1/provider/create
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Delete provider
// DELETE /api/v1/provider/delete/:id
// ─────────────────────────────────────────────────────────────────────────────
export const deleteProvider = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const hasBookings = await mongoose.model("Booking").findOne({
    $or: [{ provider: id }, { "services.provider": id }],
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

// ─────────────────────────────────────────────────────────────────────────────
// Get all providers (paginated + filtered)
// GET /api/v1/provider/getAll
//
// Query params:
//   type   — filter by provider type (hotel, car_rental, etc.)
//   name   — partial name search (case-insensitive)  ← NEW
//   page, size
// ─────────────────────────────────────────────────────────────────────────────
export const getAllProviders = asyncHandler(async (req, res, next) => {
  const { type, name, page, size } = req.query;

  const query = {};
  if (type) query.type = type;
  // Bug fix: allow partial name search for dropdowns / autocomplete
  if (name) query.name = { $regex: name.trim(), $options: "i" };

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

// ─────────────────────────────────────────────────────────────────────────────
// Get provider by ID
// GET /api/v1/provider/get/:id
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Update provider
// PATCH /api/v1/provider/update/:id
//
// Bug 5 fix: duplicate name check excludes the current document.
// ─────────────────────────────────────────────────────────────────────────────
export const updateProvider = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const update = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (
      key !== "_id" &&
      key !== "currentSequence" &&
      key !== "totalBookings" &&
      key !== "summary" &&
      value != null
    ) {
      update[key] = value;
    }
  }

  // Prevent renaming to an already-taken name
  if (update.name) {
    const duplicate = await providerModel.findOne({
      name: update.name,
      _id: { $ne: id },
    });
    if (duplicate) {
      return next(
        new Error(
          `Provider name "${update.name}" is already taken by another provider.`,
          { cause: 400 },
        ),
      );
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

// ─────────────────────────────────────────────────────────────────────────────
// Resync a single provider summary
// POST /api/v1/provider/:id/resync
// ─────────────────────────────────────────────────────────────────────────────
export const resyncProvider = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const provider = await providerModel.findById(id).select("_id name");
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  const summary = await resyncProviderSummary(id);

  await logModel.create({
    user: req.user._id,
    action: "RESYNC_PROVIDER_SUMMARY",
    details: { providerId: id, providerName: provider.name, summary },
  });

  return res.status(200).json({
    success: true,
    message: `Provider "${provider.name}" summary resynced successfully`,
    data: { summary },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resync ALL providers
// POST /api/v1/provider/resync-all
// ─────────────────────────────────────────────────────────────────────────────
export const resyncAllProviders = asyncHandler(async (req, res, next) => {
  const providers = await providerModel.find({}).select("_id name").lean();

  const results = [];
  const errors = [];

  for (const provider of providers) {
    try {
      const summary = await resyncProviderSummary(provider._id.toString());
      results.push({ providerId: provider._id, name: provider.name, summary });
    } catch (err) {
      errors.push({
        providerId: provider._id,
        name: provider.name,
        error: err.message,
      });
    }
  }

  await logModel.create({
    user: req.user._id,
    action: "RESYNC_ALL_PROVIDER_SUMMARIES",
    details: {
      total: providers.length,
      succeeded: results.length,
      failed: errors.length,
    },
  });

  return res.status(200).json({
    success: true,
    message: `Resynced ${results.length} of ${providers.length} providers`,
    data: { results, errors },
    errors: errors.length ? errors : null,
  });
});
