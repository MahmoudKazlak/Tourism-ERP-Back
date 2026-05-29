import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money received FROM a provider who collected on our agency's behalf.
 *
 * Hook design (same pattern as providerPayment.model.js):
 *   pre-save captures isNew → post-save only increments on creation.
 *   This prevents double-counting if the document is ever re-saved.
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

// ── pre-save: capture isNew BEFORE Mongoose flips it to false ────────────────
providerCollectionSchema.pre("save", function () {
  this._wasNew = this.isNew;
});

// ── post-save: only increment on document CREATION ───────────────────────────
providerCollectionSchema.post("save", async function () {
  if (!this._wasNew) return; // skip updates
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
