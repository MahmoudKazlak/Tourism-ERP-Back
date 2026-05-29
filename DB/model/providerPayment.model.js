import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money paid OUT to a provider (hotel, car company, etc.).
 *
 * Hook design:
 *   post-save fires on BOTH create and update. We capture isNew in pre-save
 *   (_wasNew) and skip the summary increment on updates — edits apply only
 *   the net diff via applyProviderSummaryDelta in the controller directly.
 *   This prevents double-counting when editProviderPayment saves the doc.
 */
const providerPaymentSchema = new mongoose.Schema(
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

providerPaymentSchema.index({ provider: 1, date: -1 });

// ── pre-save: capture isNew BEFORE Mongoose flips it to false ────────────────
providerPaymentSchema.pre("save", function () {
  this._wasNew = this.isNew;
});

// ── post-save: only increment summary on document CREATION ───────────────────
// Updates are handled explicitly in editProviderPayment with a net diff delta
// to avoid double-counting the full amount on every save.
providerPaymentSchema.post("save", async function () {
  if (!this._wasNew) return; // skip updates
  try {
    await applyProviderSummaryDelta(this.provider, {
      totalWeHavePaid: this.amount,
    });
  } catch (err) {
    console.error(
      "❌ Provider summary sync failed after providerPayment save:",
      err.message,
    );
  }
});

// ── post-deleteOne: reverse the increment ────────────────────────────────────
providerPaymentSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    try {
      await applyProviderSummaryDelta(this.provider, {
        totalWeHavePaid: -this.amount,
      });
    } catch (err) {
      console.error(
        "❌ Provider summary sync failed after providerPayment delete:",
        err.message,
      );
    }
  },
);

export default mongoose.model("ProviderPayment", providerPaymentSchema);
