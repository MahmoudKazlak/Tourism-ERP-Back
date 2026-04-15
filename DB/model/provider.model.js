import mongoose from "mongoose";

/**
 * Embedded financial summary for a provider.
 *
 * All fields are updated atomically via a single MongoDB aggregation-pipeline
 * update in providerSummaryService.applyProviderSummaryDelta(). They represent
 * "all-time" totals and are derived from four source collections:
 *
 *   totalBuy                ← Σ(service.buy)  across all bookings
 *   totalSell               ← Σ(service.sell) across all bookings
 *   totalWeHavePaid         ← Σ(ProviderPayment.amount)
 *   totalCustomersPaidDirect← Σ(Payment.amount where providerRecipient = this)
 *   totalCollectedFromProvider ← Σ(ProviderCollection.amount)
 *
 * Derived fields (recomputed in the same DB round-trip):
 *   totalCredits = totalWeHavePaid + totalCustomersPaidDirect
 *   currentBalance = totalBuy − totalCredits + totalCollectedFromProvider
 *   balanceType / balanceLabel = human-readable position
 *
 * Balance semantics:
 *   > 0  → we still owe the provider ("we_owe_provider")
 *   < 0  → provider owes us (they collected more than their service cost)
 *   = 0  → settled
 */
const providerSummarySchema = new mongoose.Schema(
  {
    totalBuy: { type: Number, default: 0 },
    totalSell: { type: Number, default: 0 },
    totalWeHavePaid: { type: Number, default: 0 },
    totalCustomersPaidDirect: { type: Number, default: 0 },
    totalCollectedFromProvider: { type: Number, default: 0 },
    // Derived — recomputed on every delta update
    totalCredits: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    balanceType: {
      type: String,
      enum: ["we_owe_provider", "provider_owes_us", "settled"],
      default: "settled",
    },
    balanceLabel: {
      type: String,
      default: "Account settled — no outstanding balance",
    },
    // When was this summary last written (for debugging / staleness checks)
    lastSynced: { type: Date, default: null },
  },
  { _id: false }, // embedded — no separate _id needed
);

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["hotel", "car_rental", "driver_company", "tourism"],
      required: true,
    },
    currentSequence: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    phone: String,
    address: String,

    /**
     * Persisted financial summary — O(1) read instead of multi-collection scan.
     * Kept in sync automatically by Mongoose hooks on Booking, ProviderPayment,
     * Payment (controller-level), and ProviderCollection.
     *
     * Use providerSummaryService.resyncProviderSummary() to rebuild from scratch
     * if drift is suspected.
     */
    summary: { type: providerSummarySchema, default: () => ({}) },
  },
  { timestamps: true },
);

export default mongoose.model("Provider", providerSchema);
