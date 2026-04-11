import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { notifyBookingStatusChanged } from "../../../services/notification.js";
import { pagination } from "../../../services/pagination.js";
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

export const createBooking = asyncHandler(async (req, res, next) => {
  const data = req.body;

  const providerExists = await providerModel.findById(data.provider);
  if (!providerExists)
    return next(new Error("Main Provider not found", { cause: 404 }));

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

export const getAllBookings = asyncHandler(async (req, res) => {
  const {
    bookingID, // Feature [3]: numeric human-readable ID search
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

  // Feature [3]: exact match on the numeric bookingID field.
  if (bookingID) query.bookingID = parseInt(bookingID);

  // FIX [5]: The Joi validation schema (getAllBookingsQuery) already rejects
  // non-ObjectId strings before this code runs, preventing Mongoose CastErrors.
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

  // Feature [6]: Notify the booking creator when status changes.
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

  if (providerId && providerId !== booking.provider.toString()) {
    await mongoose.model("Provider").findByIdAndUpdate(providerId, {
      $inc: { currentSequence: -1 },
    });
  }

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

export const deleteBooking = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const booking = await bookingModel.findById(id);
  if (!booking) return next(new Error("Booking not found", { cause: 404 }));

  const Provider = mongoose.model("Provider");

  await Provider.findByIdAndUpdate(booking.provider, {
    $inc: { currentSequence: -1, totalBookings: -1 },
  });

  const services = [
    { items: booking.accommodations, pKey: "hotel" },
    { items: booking.carRentals, pKey: "provider" },
    { items: booking.tripsWithDrivers, pKey: "provider" },
  ];

  for (const service of services) {
    for (const item of service.items) {
      const pId = item[service.pKey]?.toString();
      if (pId && pId !== booking.provider.toString()) {
        await Provider.findByIdAndUpdate(pId, {
          $inc: { currentSequence: -1 },
        });
      }
    }
  }

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
