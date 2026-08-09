import mongoose from "mongoose";

const providerSummarySchema = new mongoose.Schema(
  {
    totalBuy: { type: Number, default: 0 },
    totalSell: { type: Number, default: 0 },
    totalWeHavePaid: { type: Number, default: 0 },
    totalCustomersPaidDirect: { type: Number, default: 0 },
    totalCollectedFromProvider: { type: Number, default: 0 },
    totalCredits: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    balanceType: {
      type: String,
      enum: ["we_owe_provider", "provider_owes_us", "settled"],
      default: "settled",
    },
    /**
     * @deprecated see original note — English-only, migrate to i18n on frontend.
     */
    balanceLabel: {
      type: String,
      default: "Account settled — no outstanding balance",
    },
    lastSynced: { type: Date, default: null },

    /**
     * Case 8 — agency receivables bucket.
     *
     * Deliberately SEPARATE from the fields above. Those represent
     * "provider as a service vendor we buy from" (hotel, car co., etc).
     * This represents "provider as a sales agency that owes us for bookings
     * routed through them" (bookingType: 'agency', this provider is the
     * booking's main provider).
     *
     * A provider can simultaneously be a vendor we owe money to (via the
     * fields above) AND an agency that owes us money (via this bucket) —
     * conflating the two into one signed number would require an arbitrary
     * sign convention that maps cleanly onto neither relationship.
     *
     * outstanding = totalInvoiced - totalReceived (computed on read, not stored)
     */
    agency: {
      type: {
        totalInvoiced: { type: Number, default: 0 },
        totalReceived: { type: Number, default: 0 },
        lastSynced: { type: Date, default: null },
      },
      default: () => ({}),
      _id: false,
    },
  },
  { _id: false },
);

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["hotel", "car_rental", "driver_company", "tourism","office"],
      required: true,
    },
    currentSequence: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    phone: String,
    address: String,
    summary: { type: providerSummarySchema, default: () => ({}) },
  },
  { timestamps: true },
);

export default mongoose.model("Provider", providerSchema);
