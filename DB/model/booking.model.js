import mongoose from "mongoose";
import {
  assignBookingSequences,
  calculateBookingTotals,
} from "../../src/services/bookingService.js";

const bookingSchema = new mongoose.Schema(
  {
    bookingID: Number,
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    totalToPay: { type: Number, default: 0 },
    totalToBuy: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
    },
    customers: [{ name: String, ageType: String }],
    accommodations: [
      {
        serviceNumber: Number,
        hotel: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Provider",
          required: true,
        },
        checkIn: Date,
        checkOut: Date,
        duration: Number,
        room: String,
        roomType: String,
        board: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    carRentals: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        brand: String,
        pickUp: Date,
        dropOff: Date,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    // Renamed from tripsWithDrivers for domain consistency.
    carWithDriver: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        driverName: String,
        brand: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true },
);

bookingSchema.index({ provider: 1, bookingID: 1 }, { unique: true });

bookingSchema.pre("save", async function () {
  await assignBookingSequences(this);
  calculateBookingTotals(this);
});

export default mongoose.model("Booking", bookingSchema);
