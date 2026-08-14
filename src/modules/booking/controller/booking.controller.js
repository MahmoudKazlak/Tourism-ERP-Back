import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import providerPaymentModel from "../../../../DB/model/providerPayment.model.js";
import providerCollectionModel from "../../../../DB/model/providerCollection.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { notifyBookingStatusChanged } from "../../../services/notification.js";
import { pagination } from "../../../services/pagination.js";
import { getMergedServiceTypes } from "../../../services/serviceTypeRegistry.js";
import { applyProviderSummaryDelta } from "../../../services/providerSummaryService.js";
import mongoose from "mongoose";

// ── Security helper ───────────────────────────────────────────────────────────
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Protected fields ──────────────────────────────────────────────────────────
const PROTECTED_BOOKING_FIELDS = [
  "bookingID",
  "createdBy",
  "totalPaid",
  "remainingBalance",
  "paymentStatus",
  "totalToPay",
  "totalProfit",
  "bookingType",
  "referenceCode",
];

// ── Local validation helpers ──────────────────────────────────────────────────

const validateServiceDetails = (service) => {
  const { serviceType, details = {} } = service;
  const typeDef = getMergedServiceTypes()[serviceType];
  if (!typeDef) {
    const err = new Error(`Unknown service type "${serviceType}"`);
    err.cause = 400;
    return err;
  }

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

  for (const field of typeDef.detailFields ?? []) {
    if (
      field.required &&
      (details[field.key] == null || details[field.key] === "")
    ) {
      const err = new Error(
        `Service type "${serviceType}" requires details.${field.key}`,
      );
      err.cause = 400;
      return err;
    }
  }

  return null;
};

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

// ── Sequence resync helper ────────────────────────────────────────────────────
const resyncProviderSequences = async (providerIds) => {
  if (!providerIds.length) return;

  await Promise.all(
    providerIds.map(async (providerId) => {
      const providerObjId = new mongoose.Types.ObjectId(providerId);

      const [result] = await bookingModel.aggregate([
        { $match: { "services.provider": providerObjId } },
        { $unwind: "$services" },
        { $match: { "services.provider": providerObjId } },
        { $group: { _id: null, maxSeq: { $max: "$services.serviceNumber" } } },
      ]);

      const newSequence = result?.maxSeq ?? 0;

      await providerModel.findByIdAndUpdate(providerId, {
        $set: { currentSequence: newSequence },
      });
    }),
  );
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
// NEW
export const getAllBookings = asyncHandler(async (req, res) => {
  // NEW
  const {
    bookingID,
    provider,
    serviceType,
    status,
    paymentStatus,
    customerName,
    q,
    bookingType,
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
  if (bookingType) query.bookingType = bookingType;

  if (customerName)
    query["customers.name"] = {
      $regex: escapeRegex(customerName.trim()),
      $options: "i",
    };

  // Case 8: general search — powers BookingLinkPicker. Matches bookingID
  // (exact, when numeric), referenceCode (partial, case-insensitive), or
  // customer name (partial, case-insensitive). Independent of customerName above.
  if (q) {
    const trimmed = q.trim();
    const orConditions = [
      { referenceCode: { $regex: escapeRegex(trimmed), $options: "i" } },
      { "customers.name": { $regex: escapeRegex(trimmed), $options: "i" } },
    ];
    const numericQ = Number(trimmed);
    if (!Number.isNaN(numericQ)) {
      orConditions.push({ bookingID: numericQ });
    }
    query.$or = orConditions;
  }

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

  // NEW
  if (
    data.expectedVersion !== undefined &&
    booking.__v !== data.expectedVersion
  ) {
    return next(
      new Error(
        "This booking was modified by another user since you loaded it. Refresh and try again.",
        { cause: 409 },
      ),
    );
  }

  if (data.officeProfit !== undefined || data.providerProfit !== undefined) {
    if (booking.paymentStatus === "paid") {
      return next(
        new Error(
          "Cannot edit profit fields on a booking that is already fully paid.",
          { cause: 400 },
        ),
      );
    }
    if (booking.bookingType !== "agency") {
      return next(
        new Error(
          "providerProfit and officeProfit only apply to agency bookings.",
          { cause: 400 },
        ),
      );
    }
  }

  if (data.services && Array.isArray(data.services)) {
    const subProviderError = await validateSubProviders(data.services);
    if (subProviderError) return next(subProviderError);

    for (const service of data.services) {
      const detailError = validateServiceDetails(service);
      if (detailError) return next(detailError);
    }
  }

  const oldStatus = booking.status;

  Object.keys(data).forEach((key) => {
    if (PROTECTED_BOOKING_FIELDS.includes(key) || key === "expectedVersion")
      return;

    if (key === "services" && Array.isArray(data.services)) {
      const existingById = new Map(
        booking.services.map((s) => [s._id.toString(), s]),
      );

      const mergedIds = new Set();
      const merged = [];

      for (const newItem of data.services) {
        const existing =
          newItem._id && existingById.get(newItem._id.toString());
        if (existing) {
          merged.push({
            ...existing.toObject(),
            ...newItem,
            _id: existing._id,
            serviceNumber: newItem.serviceNumber ?? existing.serviceNumber,
          });
          mergedIds.add(existing._id.toString());
        } else {
          merged.push(newItem);
        }
      }

      for (const existing of booking.services) {
        if (!mergedIds.has(existing._id.toString())) {
          merged.push(existing.toObject());
        }
      }

      booking.services = merged;
      booking.markModified("services");
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

  try {
    await booking.save();
  } catch (err) {
    if (err.name === "VersionError") {
      return next(
        new Error(
          "This booking was modified by another user since you loaded it. Refresh and try again.",
          { cause: 409 },
        ),
      );
    }
    throw err;
  }

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
        (k) => !PROTECTED_BOOKING_FIELDS.includes(k) && k !== "expectedVersion",
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
// Edit a single existing service on a booking
//
// CASE 7 (final rule): ANY financial/detail edit to a service is blocked
// once the booking's paymentStatus is "paid". A fully paid invoice is
// considered final — buy/sell/details/notes are all locked, matching the
// same rule now applied to service removal and whole-booking deletion.
// ─────────────────────────────────────────────────────────────────────────────
export const editService = asyncHandler(async (req, res, next) => {
  const { id, serviceId } = req.params;
  const { buy, sell, details, notes, expectedVersion } = req.body;

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus === "paid") {
    return next(
      new Error(
        "Cannot edit a service on a booking that is already fully paid. " +
          "The invoice is considered final once fully paid.",
        { cause: 400 },
      ),
    );
  }

  if (expectedVersion !== undefined && booking.__v !== expectedVersion) {
    return next(
      new Error(
        "This booking was modified by another user since you loaded it. Refresh and try again.",
        { cause: 409 },
      ),
    );
  }

  const service = booking.services.id(serviceId);
  if (!service) return next(new Error("Service not found", { cause: 404 }));

  const mergedDetails =
    details !== undefined
      ? { ...service.details, ...details }
      : service.details;

  const detailError = validateServiceDetails({
    serviceType: service.serviceType,
    details: mergedDetails,
  });
  if (detailError) return next(detailError);

  if (buy !== undefined) service.buy = buy;
  if (sell !== undefined) service.sell = sell;
  if (details !== undefined) service.details = mergedDetails;
  if (notes !== undefined) service.notes = notes;

  booking.markModified("services");

  try {
    await booking.save();
  } catch (err) {
    if (err.name === "VersionError") {
      return next(
        new Error(
          "This booking was modified by another user since you loaded it. Refresh and try again.",
          { cause: 409 },
        ),
      );
    }
    throw err;
  }

  await logModel.create({
    user: req.user._id,
    action: "EDIT_SERVICE",
    details: {
      bookingID: booking.bookingID,
      serviceId,
      serviceType: service.serviceType,
      updatedFields: Object.keys(req.body).filter(
        (k) => k !== "expectedVersion",
      ),
    },
  });

  return res.status(200).json({
    success: true,
    message: "Service updated successfully",
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
  if (!providerDoc)
    return next(
      new Error(`Provider ${provider} does not exist.`, { cause: 404 }),
    );

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
//
// CASE 7 (final rule): removal blocked once paymentStatus is "paid" —
// same rationale as editService above. A partially paid booking may still
// have services removed/edited (the customer hasn't settled the full
// amount yet, so the invoice isn't final).
// ─────────────────────────────────────────────────────────────────────────────
export const removeServiceFromBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { serviceId } = req.body;

  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus === "paid") {
    return next(
      new Error(
        "Cannot remove a service from a booking that is already fully paid. " +
          "The invoice is considered final once fully paid.",
        { cause: 400 },
      ),
    );
  }

  const serviceItem = booking.services.find(
    (item) => item._id.toString() === serviceId,
  );
  if (!serviceItem) return next(new Error("Service not found", { cause: 404 }));

  const removedProviderId = serviceItem.provider?.toString();

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

  if (removedProviderId) {
    await resyncProviderSequences([removedProviderId]);
  }

  return res.status(200).json({
    success: true,
    message: "Service removed successfully",
    data: { booking },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete booking
//
// CASE 7 (final rule, Q1.1 superseded): deletion is now blocked whenever
// the booking has received ANY payment — i.e. paymentStatus is "partial"
// OR "paid" — regardless of the booking's `status` field (pending,
// confirmed, cancelled, completed all treated the same way). Only bookings
// with paymentStatus "unpaid" may be deleted. This replaces the earlier,
// narrower "block only if status === completed" rule.
//
// The direct-to-provider payment reversal fix from the previous iteration
// is retained below for defense-in-depth, though in practice an "unpaid"
// booking should have zero Payment records to reverse.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (booking.paymentStatus !== "unpaid") {
    return next(
      new Error(
        "Cannot delete a booking that has received payments. " +
          "Bookings with partial or full payment cannot be deleted, regardless of their status.",
        { cause: 400 },
      ),
    );
  }

  const affectedProviderIds = [
    ...new Set(
      (booking.services || [])
        .map((s) => s.provider?.toString())
        .filter(Boolean),
    ),
  ];

  await mongoose.model("Provider").findByIdAndUpdate(booking.provider, {
    $inc: { totalBookings: -1 },
  });

  // Defense-in-depth: reverse any direct-to-provider payment deltas before
  // the Payment documents are deleted. An "unpaid" booking should have no
  // such records, but this guards against any inconsistent intermediate
  // state rather than assuming the invariant always holds.
  const directPayments = await paymentModel
    .find({ booking: id, providerRecipient: { $ne: null } })
    .select("providerRecipient amount");

  const directTotalsByProvider = new Map();
  for (const p of directPayments) {
    const key = p.providerRecipient.toString();
    directTotalsByProvider.set(
      key,
      (directTotalsByProvider.get(key) || 0) + p.amount,
    );
  }

  for (const [providerId, total] of directTotalsByProvider) {
    await applyProviderSummaryDelta(
      providerId,
      { totalCustomersPaidDirect: -total },
      "booking_delete_direct_payment_reversal",
    );
  }

  await paymentModel.deleteMany({ booking: id });

  await logModel.create({
    user: req.user._id,
    action: "DELETE_BOOKING",
    details: {
      bookingID: booking.bookingID,
      customer: booking.customers[0]?.name,
      reversedDirectPayments: Object.fromEntries(directTotalsByProvider),
    },
  });

  await booking.deleteOne();

  await resyncProviderSequences(affectedProviderIds);

  return res.status(200).json({
    success: true,
    message: "Booking deleted successfully",
    data: null,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Change booking status
// ─────────────────────────────────────────────────────────────────────────────
export const editStatus = asyncHandler(async (req, res, next) => {
  const { newStatus } = req.body;
  if (!newStatus)
    return next(new Error("Enter the new status", { cause: 400 }));

  const booking = await bookingModel.findById(req.params.id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  if (newStatus === "completed" && booking.paymentStatus !== "paid") {
    return next(
      new Error(
        "Can't mark booking as completed while there is a remaining balance",
        { cause: 400 },
      ),
    );
  }

  booking.status = newStatus;
  await booking.save();

  return res.status(200).json({
    success: true,
    message: "Booking status changed successfully",
    data: { booking },
    errors: null,
  });
});

// NEW function — add at end of file
/**
 * Returns all ProviderPayments and ProviderCollections linked (via the
 * `booking` ObjectId ref) to the given booking. Powers the reverse-direction
 * "Linked Transactions" panel on BookingDetailPage, completing the
 * bi-directional traceability required by Case 8.
 *
 * GET /api/v1/booking/:id/linked-transactions
 */
export const getLinkedTransactions = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const exists = await bookingModel.exists({ _id: id });
  if (!exists) return next(new Error("Booking not found", { cause: 404 }));

  const [providerPayments, providerCollections] = await Promise.all([
    providerPaymentModel
      .find({ booking: id })
      .populate("provider", "name type")
      .populate("recordedBy", "userName")
      .sort({ date: -1 })
      .lean(),
    providerCollectionModel
      .find({ booking: id })
      .populate("provider", "name type")
      .populate("recordedBy", "userName")
      .sort({ date: -1 })
      .lean(),
  ]);

  return res.status(200).json({
    success: true,
    message: "Linked transactions retrieved successfully",
    data: { providerPayments, providerCollections },
    errors: null,
  });
});