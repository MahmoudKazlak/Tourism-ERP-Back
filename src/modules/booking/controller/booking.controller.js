import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { notifyBookingStatusChanged } from "../../../services/notification.js";
import { pagination } from "../../../services/pagination.js";
import { SERVICE_TYPES } from "../../../config/serviceTypes.js";
import mongoose from "mongoose";

const PROTECTED_BOOKING_FIELDS = [
  "bookingID",
  "createdBy",
  "totalPaid",
  "remainingBalance",
  "paymentStatus",
  "totalToPay",
  "totalProfit",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates type-specific required fields inside service.details.
 * Returns an Error (to pass to next()) or null when valid.
 */
const validateServiceDetails = (service) => {
  const { serviceType, details = {} } = service;
  const typeDef = SERVICE_TYPES[serviceType];
  if (!typeDef) return null; // unknown types are caught by Joi

  if (typeDef.durationFields) {
    const { from, to } = typeDef.durationFields;
    if (!details[from] || !details[to]) {
      const err = new Error(
        `Service type "${serviceType}" requires details.${from} and details.${to}`,
      );
      err.cause = 400;
      return err;
    }
    if (new Date(details[to]) <= new Date(details[from])) {
      const err = new Error(
        `details.${to} must be after details.${from} for service type "${serviceType}"`,
      );
      err.cause = 400;
      return err;
    }
  }

  return null;
};

/**
 * Confirms every service provider ID exists in the DB.
 * Returns an Error or null when all are valid.
 */
const validateSubProviders = async (services = []) => {
  if (services.length === 0) return null;

  const uniqueIds = [
    ...new Set(services.map((s) => s.provider?.toString()).filter(Boolean)),
  ];
  const foundCount = await providerModel.countDocuments({
    _id: { $in: uniqueIds },
  });

  if (foundCount !== uniqueIds.length) {
    const err = new Error(
      "One or more service providers do not exist. Verify all provider IDs before submitting.",
    );
    err.cause = 404;
    return err;
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Create booking
// ─────────────────────────────────────────────────────────────────────────────
export const createBooking = asyncHandler(async (req, res, next) => {
  const data = req.body;

  const providerExists = await providerModel.findById(data.provider);
  if (!providerExists)
    return next(new Error("Main Provider not found", { cause: 404 }));

  const subProviderError = await validateSubProviders(data.services);
  if (subProviderError) return next(subProviderError);

  for (const service of data.services || []) {
    const detailError = validateServiceDetails(service);
    if (detailError) return next(detailError);
  }

  if (data.totalPax) {
    data.totalPax.total =
      (Number(data.totalPax.adults) || 0) + (Number(data.totalPax.kids) || 0);
  }

  data.createdBy = req.user._id;

  const booking = await bookingModel.create(data);

  await logModel.create({
    user: req.user._id,
    action: "CREATE_BOOKING",
    details: {
      bookingID: booking.bookingID,
      mongoId: booking._id,
      customerNames: booking.customers
        .filter((c) => c?.name)
        .map((c) => c.name),
    },
  });

  return res.status(201).json({
    success: true,
    message: "Booking created successfully",
    data: { bookingID: booking.bookingID, booking },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all bookings
// ─────────────────────────────────────────────────────────────────────────────
export const getAllBookings = asyncHandler(async (req, res) => {
  const {
    bookingID,
    provider,
    serviceType,
    status,
    paymentStatus,
    customerName,
    fromDate,
    toDate,
    minAmount,
    maxAmount,
    sortBy = "createdAt",
    sortOrder = "desc",
    page,
    size,
  } = req.query;

  const query = {};

  if (bookingID) query.bookingID = parseInt(bookingID);
  if (provider) query.provider = provider;
  if (serviceType) query["services.serviceType"] = serviceType;
  if (status) query.status = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (customerName)
    query["customers.name"] = { $regex: customerName, $options: "i" };

  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.createdAt.$lte = to;
    }
  }

  if (minAmount || maxAmount) {
    query.totalToPay = {};
    if (minAmount) query.totalToPay.$gte = Number(minAmount);
    if (maxAmount) query.totalToPay.$lte = Number(maxAmount);
  }

  const allowedSortFields = [
    "createdAt",
    "bookingID",
    "totalToPay",
    "totalProfit",
  ];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
  const sort = { [sortField]: sortOrder === "asc" ? 1 : -1 };

  const { limit, skip } = pagination(page, size);

  const [bookings, totalCount] = await Promise.all([
    bookingModel
      .find(query)
      .populate("provider", "name type")
      .populate("createdBy", "userName")
      .populate("services.provider", "name type")
      .limit(limit)
      .skip(skip)
      .sort(sort),
    bookingModel.countDocuments(query),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      page: parseInt(page) || 1,
      totalPages: Math.ceil(totalCount / limit),
      results: bookings.length,
      bookings,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get booking by ID
// ─────────────────────────────────────────────────────────────────────────────
export const getBookingById = asyncHandler(async (req, res, next) => {
  const booking = await bookingModel
    .findById(req.params.id)
    .populate("provider createdBy")
    .populate("services.provider", "name type phone address");

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const payments = await paymentModel
    .find({ booking: booking._id })
    .populate("recordedBy", "userName")
    .populate("providerRecipient", "name")
    .sort({ date: -1 });

  return res.status(200).json({
    success: true,
    message: "Booking retrieved successfully",
    data: { booking, payments },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update booking
// ─────────────────────────────────────────────────────────────────────────────
export const updateBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const data = req.body;

  const booking = await bookingModel
    .findById(id)
    .populate("createdBy", "userName email");
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const oldStatus = booking.status;

  Object.keys(data).forEach((key) => {
    if (PROTECTED_BOOKING_FIELDS.includes(key)) return;

    if (key === "services" && Array.isArray(data.services)) {
      // Merge by index — preserve serviceNumber on existing items
      booking.services = data.services.map((newItem, index) => {
        const oldItem = booking.services[index];
        if (oldItem) {
          return {
            ...oldItem.toObject(),
            ...newItem,
            _id: oldItem._id,
            serviceNumber: newItem.serviceNumber ?? oldItem.serviceNumber,
          };
        }
        return newItem;
      });
    } else if (key === "totalPax") {
      booking.totalPax = { ...booking.totalPax?.toObject(), ...data[key] };
    } else {
      booking[key] = data[key];
    }
  });

  if (booking.totalPax) {
    booking.totalPax.total =
      (Number(booking.totalPax.adults) || 0) +
      (Number(booking.totalPax.kids) || 0);
  }

  await booking.save();

  const newStatus = booking.status;
  if (data.status && data.status !== oldStatus) {
    await notifyBookingStatusChanged(booking, oldStatus, newStatus);
  }

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_BOOKING",
    details: {
      bookingID: booking.bookingID,
      updatedFields: Object.keys(data).filter(
        (k) => !PROTECTED_BOOKING_FIELDS.includes(k),
      ),
      statusChange: data.status
        ? { from: oldStatus, to: newStatus }
        : undefined,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Booking updated successfully",
    data: { booking },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Add service to existing booking
// ─────────────────────────────────────────────────────────────────────────────
export const addServiceToBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { serviceType, provider, buy, sell, details } = req.body;

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const providerDoc = await providerModel.findById(provider).select("_id");
  if (!providerDoc) {
    return next(
      new Error(`Provider ${provider} does not exist.`, { cause: 404 }),
    );
  }

  const detailError = validateServiceDetails({
    serviceType,
    details: details || {},
  });
  if (detailError) return next(detailError);

  booking.services.push({
    serviceType,
    provider,
    buy: buy || 0,
    sell: sell || 0,
    details: details || {},
  });
  booking.markModified("services");
  await booking.save();

  const addedService = booking.services[booking.services.length - 1];

  await logModel.create({
    user: req.user._id,
    action: "ADD_SERVICE",
    details: {
      bookingID: booking.bookingID,
      serviceType,
      serviceNumber: addedService.serviceNumber,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Service added successfully",
    data: { serviceNumber: addedService.serviceNumber, booking },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Remove service from existing booking
// ─────────────────────────────────────────────────────────────────────────────
export const removeServiceFromBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { serviceId } = req.body;

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const serviceItem = booking.services.find(
    (item) => item._id.toString() === serviceId,
  );
  if (!serviceItem) return next(new Error("Service not found", { cause: 404 }));

  // currentSequence is a high-water mark — never decrement on remove.
  await logModel.create({
    user: req.user._id,
    action: "REMOVE_SERVICE",
    details: {
      bookingID: booking.bookingID,
      serviceType: serviceItem.serviceType,
      serviceNumber: serviceItem.serviceNumber,
      providerId: serviceItem.provider,
    },
  });

  booking.services = booking.services.filter(
    (item) => item._id.toString() !== serviceId,
  );
  await booking.save();

  return res.status(200).json({
    success: true,
    message: "Service removed successfully",
    data: { booking },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete booking
// ─────────────────────────────────────────────────────────────────────────────
export const deleteBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  await mongoose.model("Provider").findByIdAndUpdate(booking.provider, {
    $inc: { totalBookings: -1 },
  });

  await paymentModel.deleteMany({ booking: id });

  await logModel.create({
    user: req.user._id,
    action: "DELETE_BOOKING",
    details: {
      bookingID: booking.bookingID,
      customer: booking.customers[0]?.name,
    },
  });

  await booking.deleteOne();

  return res.status(200).json({
    success: true,
    message: "Booking deleted successfully",
    data: null,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Change Booking Status
// ─────────────────────────────────────────────────────────────────────────────
export const editStatus = asyncHandler(async (req, res, next) => {
  const { newStatus } = req.body;
  if (!newStatus)
    return next(new Error("Enter the new status", { cause: 404 }));

  const booking = await bookingModel.findByIdAndUpdate(
    req.params.id,
    { status: newStatus },
    { new: true, runValidators: true },
  );

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (newStatus === "completed" && booking.paymentStatus !== "paid")
    return next(
      new Error(
        "Can't mark booking as completed while there is a remaining balance",
        { cause: 400 },
      ),
    );

  return res.status(200).json({
    success: true,
    message: "Booking status changed successfully",
    data: { booking },
    errors: null,
  });
});
