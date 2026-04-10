import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as bookingController from "./controller/booking.controller.js";
import * as validators from "./booking.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// Create booking
router.post(
  "/create",
  auth(endpoint.booking_manage),
  validation(validators.createBooking),
  bookingController.createBooking,
);

// Get all bookings
router.get(
  "/getAll",
  auth(endpoint.booking_view),
  bookingController.getAllBookings,
);

// Get a booking by ID
router.get(
  "/get/:id",
  auth(endpoint.booking_view),
  validation(validators.bookingIdParam),
  bookingController.getBookingById,
);

// Update booking
router.patch(
  "/edit/:id",
  auth(endpoint.booking_manage),
  validation(validators.updateBooking),
  bookingController.updateBooking,
);

// Add a service to an existing booking
router.patch(
  "/:id/addService",
  auth(endpoint.booking_manage),
  validation(validators.addService),
  bookingController.addServiceToBooking,
);

// Remove a service from an existing booking
router.patch(
  "/:id/remove",
  auth(endpoint.booking_manage),
  validation(validators.removeService),
  bookingController.removeServiceFromBooking,
);

// Delete booking
router.delete(
  "/delete/:id",
  auth(endpoint.booking_delete),
  validation(validators.bookingIdParam),
  bookingController.deleteBooking,
);

// NOTE: Provider statement was previously duplicated here under
// GET /booking/statement/:providerId. It has been removed.
// Use GET /api/v1/statement/provider/:providerId instead.

export default router;
