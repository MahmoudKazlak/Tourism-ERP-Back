import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { notifyBookingStatusChanged } from "../../../services/notification.js";
import { pagination } from "../../../services/pagination.js";
import mongoose from "mongoose";

// Fields that must never be overwritten via updateBooking.
// These are computed values managed by the pre-save hook and payment logic.
const PROTECTED_BOOKING_FIELDS = [
  "bookingID",
  "createdBy",
  "totalPaid",
  "remainingBalance",
  "paymentStatus",
  "totalToPay",
  "totalProfit",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that every sub-service provider ID referenced in the booking body
 * actually exists in the Provider collection.
 *
 * Returns null when all IDs are valid; returns an Error when any are missing.
 * Designed to be called with `next(validateSubProviders(...))` so it short-
 * circuits the controller immediately.
 *
 * FIX: Previously the controller only checked the main `provider` field.
 * Hotel, car rental, and trip driver providers were never validated against the
 * database — an invalid ObjectId that passed Joi format checks (valid 24-hex
 * string but non-existent document) would silently persist as an orphaned
 * reference inside the booking sub-document.
 *
 * @param {object} data - Parsed request body (post-Joi-validation).
 * @returns {Error|null}
 */
const validateSubProviders = async (data) => {
  const subProviderIds = [
    ...(data.accommodations || []).map((a) => a.hotel),
    ...(data.carRentals || []).map((c) => c.provider),
    ...(data.tripsWithDrivers || []).map((t) => t.provider),
  ].filter(Boolean);

  if (subProviderIds.length === 0) return null;

  const uniqueIds = [...new Set(subProviderIds.map(String))];
  const foundCount = await providerModel.countDocuments({
    _id: { $in: uniqueIds },
  });

  if (foundCount !== uniqueIds.length) {
    const err = new Error(
      "One or more service providers (hotel, car rental, or driver company) " +
        "do not exist. Verify all provider IDs before submitting.",
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

  // Validate main provider.
  const providerExists = await providerModel.findById(data.provider);
  if (!providerExists)
    return next(new Error("Main Provider not found", { cause: 404 }));

  // FIX: Validate all sub-service provider references before touching the DB.
  const subProviderError = await validateSubProviders(data);
  if (subProviderError) return next(subProviderError);

  if (data.accommodations) {
    data.accommodations.forEach((acc) => {
      if (acc.checkIn && acc.checkOut) {
        acc.duration = Math.ceil(
          (new Date(acc.checkOut) - new Date(acc.checkIn)) /
            (1000 * 60 * 60 * 24),
        );
      }
    });
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

  // Numeric bookingID filter (exact match on the human-readable sequence number).
  if (bookingID) query.bookingID = parseInt(bookingID);

  // provider is already validated as a valid ObjectId by Joi (getAllBookingsQuery
  // schema) so no CastError can reach MongoDB.
  if (provider) query.provider = provider;
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
    .populate(
      "provider accommodations.hotel carRentals.provider tripsWithDrivers.provider createdBy",
    );

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const payments = await paymentModel
    .find({ booking: booking._id })
    .populate("recordedBy", "userName")
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

  // Populate createdBy so we have the email for notifications.
  const booking = await bookingModel
    .findById(id)
    .populate("createdBy", "userName email");
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const oldStatus = booking.status;
  const serviceArrays = ["accommodations", "carRentals", "tripsWithDrivers"];

  Object.keys(data).forEach((key) => {
    if (PROTECTED_BOOKING_FIELDS.includes(key)) return;

    if (serviceArrays.includes(key) && Array.isArray(data[key])) {
      booking[key] = data[key].map((newItem, index) => {
        const oldItem = booking[key][index];
        if (oldItem) {
          return {
            ...oldItem.toObject(),
            ...newItem,
            _id: oldItem._id,
            serviceNumber: newItem.serviceNumber || oldItem.serviceNumber,
          };
        }
        return newItem;
      });
    } else if (key === "totalPax") {
      booking.totalPax = { ...booking.totalPax.toObject(), ...data[key] };
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

  // Notify the booking creator when status changes.
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
  const { serviceType, serviceData } = req.body;

  const validServiceTypes = [
    "accommodations",
    "carRentals",
    "tripsWithDrivers",
  ];
  if (!validServiceTypes.includes(serviceType)) {
    return next(new Error("Invalid service type", { cause: 400 }));
  }

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  // FIX: Validate the service provider reference before touching the booking.
  // Previously this was not checked at all, allowing orphaned references to be
  // pushed into the sub-document array.
  const providerKey = serviceType === "accommodations" ? "hotel" : "provider";
  const serviceProviderId = serviceData[providerKey];

  if (serviceProviderId) {
    const exists = await providerModel
      .findById(serviceProviderId)
      .select("_id");
    if (!exists) {
      return next(
        new Error(
          `Service provider ${serviceProviderId} does not exist. ` +
            `Cannot add service to booking.`,
          { cause: 404 },
        ),
      );
    }
  }

  booking[serviceType].push(serviceData);
  booking.markModified(serviceType);
  await booking.save();

  const addedService = booking[serviceType][booking[serviceType].length - 1];

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
  const { serviceType, serviceId } = req.body;

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const serviceItem = booking[serviceType].find(
    (item) => item._id.toString() === serviceId,
  );
  if (!serviceItem) return next(new Error("Service not found", { cause: 404 }));

  const pKey = serviceType === "accommodations" ? "hotel" : "provider";
  const providerId = serviceItem[pKey]?.toString();

  // BUG FIX: Do NOT decrement the sub-provider's currentSequence.
  //
  // currentSequence is a HIGH-WATER MARK — the highest serviceNumber ever
  // issued to that provider. Decrementing it causes the next service added for
  // that provider to receive the same number as an existing service on another
  // booking, which is a data integrity violation.
  //
  // The old code: Provider.findByIdAndUpdate(providerId, { $inc: { currentSequence: -1 } })
  // is removed entirely. Service numbers are permanent once issued.

  await logModel.create({
    user: req.user._id,
    action: "REMOVE_SERVICE",
    details: {
      bookingID: booking.bookingID,
      serviceType,
      serviceNumber: serviceItem.serviceNumber,
      providerId,
    },
  });

  booking[serviceType] = booking[serviceType].filter(
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

  const Provider = mongoose.model("Provider");

  // BUG FIX: Only decrement `totalBookings` (a stats counter).
  //
  // DO NOT decrement `currentSequence`.
  //
  // currentSequence is the high-water mark for bookingID generation.
  // If we decrement it after a deletion, the next booking created for this
  // provider receives a bookingID that may already exist on another booking
  // document, triggering an E11000 duplicate key error on the
  // { provider_1_bookingID_1 } unique index.
  //
  // Example of the bug this fixes:
  //   B1→seq=1, B2→seq=2, B3→seq=3
  //   Delete B2 → (old buggy code) seq decremented to 2
  //   Create B4 → seq incremented to 3 → DUPLICATE KEY (B3 still has bookingID=3)
  //
  // Correct behaviour: seq stays at 3, B4 gets bookingID=4.
  await Provider.findByIdAndUpdate(booking.provider, {
    $inc: { totalBookings: -1 }, // ← stats only; currentSequence untouched
  });

  // BUG FIX: Same reasoning applies to sub-providers referenced in services.
  // Their currentSequence values are also high-water marks and must not be
  // decremented. We only tracked these for sequence generation purposes, and
  // issued serviceNumbers are permanent.
  // (The old loop that decremented sub-provider currentSequence is removed.)

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
    {
      status: newStatus,
    },
    {
      new: true,
      runValidators: true,
    },
  );
  if (newStatus == "completed" && booking.paymentStatus !== "paid")
    return next(new Error("Can't make the booking completed while there is a remaining balance", { cause: 404 }));

  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  return res.status(200).json({
    success: true,
    message: "Booking status changed successfully",
    data: { booking },
    errors: null,
  });
});
