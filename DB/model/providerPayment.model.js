import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money paid OUT to a provider (hotel, car company, etc.).
 *
 * Hook design:
 *   post-save fires on BOTH create and update. We capture isNew in pre-save
 *   (_wasNew) and only increment the summary on document creation.
 *   Updates are handled explicitly in editProviderPayment with a net diff delta
 *   to prevent double-counting the full amount on every save.
 *
 * Phase 4: applyProviderSummaryDelta now receives a source tag so any
 *   resulting SyncFailure record identifies exactly which hook caused the drift.
 */
const providerPaymentSchema = new mongoose.Schema(
  {
    provider: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Provider",
      required: [true, "Provider is required"],
      index:    true,
    },
    amount: {
      type:     Number,
      required: [true, "Amount is required"],
      min:      [0.01, "Amount must be greater than 0"],
    },
    date: {
      type:     Date,
      default:  Date.now,
      required: true,
    },
    method: {
      type:    String,
      enum:    ["cash", "bank_transfer", "check", "other"],
      default: "cash",
    },
    notes: {
      type:      String,
      trim:      true,
      maxlength: [300, "Notes too long"],
    },
    reference: {
      type:      String,
      trim:      true,
      maxlength: [100, "Reference too long"],
    },
    recordedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },
  },
  { timestamps: true },
);

providerPaymentSchema.index({ provider: 1, date: -1 });

// ── pre-save: capture isNew BEFORE Mongoose flips it to false ─────────────────
providerPaymentSchema.pre("save", function () {
  this._wasNew = this.isNew;
});

// ── post-save: only increment summary on document CREATION ────────────────────
providerPaymentSchema.post("save", async function () {
  if (!this._wasNew) return; // updates handled explicitly in the controller
  await applyProviderSummaryDelta(
    this.provider,
    { totalWeHavePaid: this.amount },
    "providerPayment_save",
  );
});

// ── post-deleteOne: reverse the increment ─────────────────────────────────────
providerPaymentSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    await applyProviderSummaryDelta(
      this.provider,
      { totalWeHavePaid: -this.amount },
      "providerPayment_delete",
    );
  },
);

export default mongoose.model("ProviderPayment", providerPaymentSchema);
