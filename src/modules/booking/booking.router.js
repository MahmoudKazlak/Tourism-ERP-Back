import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { validation } from "../../middleware/validation.js";
import * as bookingController from "./controller/booking.controller.js";
import * as validators from "./booking.validation.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

router.post(
  "/create",
  auth(endpoint.booking_manage),
  validation(validators.createBooking),
  bookingController.createBooking,
);

// Feature [3] + Fix [5]: Added query validation (catches invalid ObjectIds
// before they reach MongoDB and cause a CastError 500).
router.get(
  "/getAll",
  auth(endpoint.booking_view),
  validation(validators.getAllBookingsQuery),
  bookingController.getAllBookings,
);

router.get(
  "/get/:id",
  auth(endpoint.booking_view),
  validation(validators.bookingIdParam),
  bookingController.getBookingById,
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

export default router;
