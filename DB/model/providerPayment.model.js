import mongoose from "mongoose";

/**
 * Records money paid OUT to a provider (hotel, car company, etc.).
 *
 * This is the liability side of the ledger:
 *   - paymentModel  → money received FROM customers
 *   - providerPaymentModel → money paid TO providers
 *
 * The getProviderStatement controller uses both to show the full picture:
 *   totalCostFromProvider (what you owe) vs totalPaidToProvider (what you've paid).
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

export default mongoose.model("ProviderPayment", providerPaymentSchema);
