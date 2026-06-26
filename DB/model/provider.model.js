import mongoose from "mongoose";

/**
 * Embedded financial summary for a provider.
 *
 * All fields are updated atomically via a single MongoDB aggregation-pipeline
 * update in providerSummaryService.applyProviderSummaryDelta(). They represent
 * "all-time" totals and are derived from four source collections:
 *
 *   totalBuy                 ← Σ(service.buy)  across all bookings for this provider
 *   totalSell                ← Σ(service.sell) across all bookings for this provider
 *   totalWeHavePaid          ← Σ(ProviderPayment.amount)
 *   totalCustomersPaidDirect ← Σ(Payment.amount where providerRecipient = this)
 *   totalCollectedFromProvider ← Σ(ProviderCollection.amount)
 *
 * Derived fields (recomputed in the same DB round-trip by the pipeline):
 *   totalCredits   = totalWeHavePaid + totalCustomersPaidDirect
 *   currentBalance = totalBuy − totalCredits + totalCollectedFromProvider
 *   balanceType / balanceLabel = human-readable financial position
 *
 * Balance semantics:
 *   currentBalance > 0  → we still owe the provider   ("we_owe_provider")
 *   currentBalance < 0  → provider owes us            ("provider_owes_us")
 *   currentBalance ≈ 0  → account is settled          ("settled")
 */
const providerSummarySchema = new mongoose.Schema(
  {
    totalBuy:                   { type: Number, default: 0 },
    totalSell:                  { type: Number, default: 0 },
    totalWeHavePaid:            { type: Number, default: 0 },
    totalCustomersPaidDirect:   { type: Number, default: 0 },
    totalCollectedFromProvider: { type: Number, default: 0 },
    // Derived — recomputed atomically on every delta update
    totalCredits:   { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    balanceType: {
      type:    String,
      enum:    ["we_owe_provider", "provider_owes_us", "settled"],
      default: "settled",
    },
    /**
     * @deprecated balanceLabel stores a hard-coded English sentence in the DB.
     *
     * Problem: Arabic and Turkish UI users see English text because the label
     * is generated server-side (in providerSummaryService.js) and persisted,
     * ignoring the client's locale entirely.
     *
     * The authoritative machine-readable field is `balanceType` (above). The
     * display label should be derived from it on the frontend using the i18n
     * system so it automatically respects the active language.
     *
     * Migration plan (Phase 5 / pre-multi-tenant):
     *   Step 1: Replace all frontend reads of `provider.summary.balanceLabel`
     *           with a local `t("providers.balanceType.${balanceType}")` call.
     *   Step 2: Once no frontend consumer reads balanceLabel, remove this field
     *           from the schema and from buildSummaryPipeline in
     *           providerSummaryService.js.
     *   Step 3: Run a one-off migration to $unset balanceLabel from all existing
     *           provider documents.
     *
     * Do NOT remove this field until Step 1 is verified in production.
     */
    balanceLabel: {
      type:    String,
      default: "Account settled — no outstanding balance",
    },
    // When was this summary last written — useful for staleness checks / debugging
    lastSynced: { type: Date, default: null },
  },
  { _id: false }, // embedded — no separate _id needed
);

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type:     String,
      enum:     ["hotel", "car_rental", "driver_company", "tourism"],
      required: true,
    },
    // currentSequence is a high-water mark — NEVER decremented.
    // Decrementing it causes duplicate service numbers. Only totalBookings (a
    // statistics counter) is decremented when a booking is deleted.
    currentSequence: { type: Number, default: 0 },
    totalBookings:   { type: Number, default: 0 },
    phone:   String,
    address: String,
    /**
     * Persisted financial summary — O(1) read per provider instead of a
     * multi-collection full scan. Kept in sync automatically by Mongoose hooks
     * on Booking, ProviderPayment, Payment (controller-level), and
     * ProviderCollection.
     *
     * If drift is suspected use:
     *   POST /api/v1/provider/:id/resync
     *   POST /api/v1/provider/resync-all
     */
    summary: { type: providerSummarySchema, default: () => ({}) },
  },
  { timestamps: true },
);

export default mongoose.model("Provider", providerSchema);
