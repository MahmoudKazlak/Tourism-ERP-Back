import mongoose from "mongoose";
import { applyProviderSummaryDelta } from "../../src/services/providerSummaryService.js";

const providerPaymentSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: [true, "Provider is required"],
      index: true,
    },
    // Case 8: optional link back to the originating booking. Nullable —
    // a lump-sum payment settling multiple bookings won't have one.
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
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

providerPaymentSchema.pre("save", function () {
  this._wasNew = this.isNew;
});

providerPaymentSchema.post("save", async function () {
  if (!this._wasNew) return;
  await applyProviderSummaryDelta(
    this.provider,
    { totalWeHavePaid: this.amount },
    "providerPayment_save",
  );
});

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
