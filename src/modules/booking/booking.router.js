import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as bookingController from "./controller/booking.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

//Create booking
router.post(
  "/create",
  auth(endpoint.booking_manage),
  bookingController.createBooking,
);
//Get all bookings
router.get(
  "/getAll",
  auth(endpoint.booking_view),
  bookingController.getAllBookings,
);

//Get a booking by Id
router.get(
  "/get/:id",
  auth(endpoint.booking_view),
  bookingController.getBookingById,
);
//Edit booking
router.patch(
  "/edit/:id",
  auth(endpoint.booking_manage),
  bookingController.updateBooking,
);

//Add service for existing Booking
router.patch(
  "/:id/addService",
  auth(endpoint.booking_manage),
  bookingController.addServiceToBooking,
);
//Remove service for existing Booking
router.patch(
  "/:id/remove",
  auth(endpoint.booking_manage),
  bookingController.removeServiceFromBooking,
);
//Delete booking by Id
router.delete(
  "/delete/:id",
  auth(endpoint.booking_delete),
  bookingController.deleteBooking,
);
//Statement
router.get(
  "/statement/:providerId",
  auth(endpoint.booking_delete),
  bookingController.getProviderStatement,
);

export default router;
