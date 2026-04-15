import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

/**
 * Records money paid OUT to a provider (hotel, car company, etc.).
 *
 * This is the liability side of the ledger:
 *   - paymentModel  → money received FROM customers
 *   - providerPaymentModel → money paid TO providers
 *
 * Hooks here keep Provider.summary.totalWeHavePaid in sync automatically.
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
    // External reference: invoice number, wire transfer ID, cheque number, etc.
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

// ── post-save: increment totalWeHavePaid ─────────────────────────────────────
providerPaymentSchema.post("save", async function () {
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
// Triggered only by doc.deleteOne() — the controller uses this form.
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
