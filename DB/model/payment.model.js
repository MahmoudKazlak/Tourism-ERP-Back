import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    bookingID: {
      type: Number,
      required: true,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    date: {
      type: Date,
      default: Date.now,
    },
    method: {
      type: String,
      enum: ["cash", "bank_transfer", "check", "other"],
      default: "cash",
    },
    notes: String,

    /**
     * When set, the customer paid this provider directly — not our office.
     *
     * Accounting effects:
     *   1. booking.totalPaid increases by `amount` → customer's debt is cleared.
     *   2. In the provider current-account ledger, `amount` (the sell price)
     *      is treated as a credit: it retires the buy-price debt AND transfers
     *      our profit to the provider as a receivable they hold for us.
     *
     * Must reference a provider that is actually linked to the booking
     * (enforced at the controller level).
     */
    providerRecipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      default: null,
    },

    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// Supports provider current-account statement queries with date ranges.
paymentSchema.index({ providerRecipient: 1, date: -1 });

export default mongoose.model("Payment", paymentSchema);
