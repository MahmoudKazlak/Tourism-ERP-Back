import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money received FROM a provider who collected on the agency's behalf.
 *
 * Hook design (mirrors providerPayment.model.js):
 *   pre-save captures isNew → post-save only increments on creation.
 *   This prevents double-counting if the document is ever re-saved.
 *
 * Phase 4: applyProviderSummaryDelta receives a source tag so SyncFailure
 *   records identify this hook as the drift origin.
 */
const providerCollectionSchema = new mongoose.Schema(
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
    booking: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Booking",
      default: null,
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

providerCollectionSchema.index({ provider: 1, date: -1 });

// ── pre-save ───────────────────────────────────────────────────────────────────
providerCollectionSchema.pre("save", function () {
  this._wasNew = this.isNew;
});

// ── post-save: only increment on creation ─────────────────────────────────────
providerCollectionSchema.post("save", async function () {
  if (!this._wasNew) return;
  await applyProviderSummaryDelta(
    this.provider,
    { totalCollectedFromProvider: this.amount },
    "providerCollection_save",
  );
});

// ── post-deleteOne: reverse the increment ─────────────────────────────────────
providerCollectionSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    await applyProviderSummaryDelta(
      this.provider,
      { totalCollectedFromProvider: -this.amount },
      "providerCollection_delete",
    );
  },
);

export default mongoose.model("ProviderCollection", providerCollectionSchema);
