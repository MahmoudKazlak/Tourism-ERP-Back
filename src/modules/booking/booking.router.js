import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as bookingController from "./controller/booking.controller.js";
import { getAllServices }       from "./controller/services.controller.js";
import * as validators from "./booking.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

// ── Static routes first (before any /:id) ────────────────────────────────────

router.post(
  "/create",
  auth(endpoint.booking_manage),
  validation(validators.createBooking),
  bookingController.createBooking,
);

router.get(
  "/getAll",
  auth(endpoint.booking_view),
  validation(validators.getAllBookingsQuery),
  bookingController.getAllBookings,
);

// NEW: flattened service line-items across all bookings
// Must be before /:id so Express doesn't treat "all-services" as an id param.
router.get(
  "/all-services",
  auth(endpoint.booking_view),
  getAllServices,
);

router.get(
  "/get/:id",
  auth(endpoint.booking_view),
  validation(validators.bookingIdParam),
  bookingController.getBookingById,
);

router.get(
  "/:id/linked-transactions",
  auth(endpoint.booking_view),
  validation(validators.bookingIdParam),
  bookingController.getLinkedTransactions,
);

router.patch(
  "/edit/:id",
  auth(endpoint.booking_manage),
  validation(validators.updateBooking),
  bookingController.updateBooking,
);

router.patch(
  "/:id/addService",
  auth(endpoint.booking_manage),
  validation(validators.addService),
  bookingController.addServiceToBooking,
);

router.patch(
  "/:id/services/:serviceId",
  auth(endpoint.booking_manage),
  validation(validators.editService),
  bookingController.editService,
);

router.patch(
  "/:id/remove",
  auth(endpoint.booking_manage),
  validation(validators.removeService),
  bookingController.removeServiceFromBooking,
);

router.delete(
  "/delete/:id",
  auth(endpoint.booking_delete),
  validation(validators.bookingIdParam),
  bookingController.deleteBooking,
);

router.patch(
  "/:id/status",
  auth(endpoint.booking_manage),
  bookingController.editStatus,
);

export default router;
