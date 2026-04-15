import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money received FROM a provider who collected on our agency's behalf.
 *
 * Context & accounting role
 * ─────────────────────────
 * When a customer pays a provider (e.g. Hotel A) the full booking amount
 * instead of paying our office, Hotel A is holding funds that partly belong
 * to us (the profit / amounts owed to other providers we must distribute).
 *
 * That event is recorded on the Payment model with providerRecipient = HotelA,
 * which makes Hotel A's balance negative (they owe us money).
 *
 * THIS model records the reverse: Hotel A paying us back that receivable.
 *
 * Statement formula impact
 * ────────────────────────
 *   balance = Σ(service buy costs)            ← we owe provider
 *           − Σ(ProviderPayment.amount)        ← we paid provider
 *           − Σ(Payment[providerRecipient=X])  ← customer paid provider
 *           + Σ(ProviderCollection.amount)     ← recovering receivable
 *
 * Hooks here keep Provider.summary.totalCollectedFromProvider in sync.
 */
const providerCollectionSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: [true, "Provider is required"],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
    method: {
      type: String,
      enum: ["cash", "bank_transfer", "check", "other"],
      default: "cash",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [300, "Notes too long"],
    },
    /**
     * Optional: which booking triggered this collection.
     * Not required because a single collection may settle multiple bookings.
     */
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: [100, "Reference too long"],
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

providerCollectionSchema.index({ provider: 1, date: -1 });

// ── post-save: increment totalCollectedFromProvider ──────────────────────────
providerCollectionSchema.post("save", async function () {
  try {
    await applyProviderSummaryDelta(this.provider, {
      totalCollectedFromProvider: this.amount,
    });
  } catch (err) {
    console.error(
      "❌ Provider summary sync failed after providerCollection save:",
      err.message,
    );
  }
});

// ── post-deleteOne: reverse the increment ────────────────────────────────────
providerCollectionSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    try {
      await applyProviderSummaryDelta(this.provider, {
        totalCollectedFromProvider: -this.amount,
      });
    } catch (err) {
      console.error(
        "❌ Provider summary sync failed after providerCollection delete:",
        err.message,
      );
    }
  },
);

export default mongoose.model("ProviderCollection", providerCollectionSchema);
