import mongoose from "mongoose";
import {
  assignBookingSequences,
  calculateBookingTotals,
} from "../../src/services/bookingService.js";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "../../src/services/providerSummaryService.js";
import { getMergedServiceTypeKeys } from "../../src/services/serviceTypeRegistry.js";

const bookingSchema = new mongoose.Schema(
  {
    bookingID: Number,
    provider: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Provider",
      required: true,
    },
    createdBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },
    status: {
      type:    String,
      enum:    ["pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    totalToPay:       { type: Number, default: 0 },
    totalToBuy:       { type: Number, default: 0 },
    totalProfit:      { type: Number, default: 0 },
    totalPaid:        { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    paymentStatus: {
      type:    String,
      enum:    ["unpaid", "partial", "paid"],
      default: "unpaid",
    },
    customers: [{ name: String, ageType: String }],
    services: [
      {
        serviceType: {
          type:     String,
          required: true,
          validate: {
            validator(v) { return getMergedServiceTypeKeys().includes(v); },
            message: "Invalid service type",
          },
        },
        serviceNumber: Number,
        provider: {
          type:     mongoose.Schema.Types.ObjectId,
          ref:      "Provider",
          required: true,
        },
        buy:      { type: Number, default: 0 },
        sell:     { type: Number, default: 0 },
        profit:   { type: Number, default: 0 },
        duration: Number,
        details:  { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true },
);

// ── pre-save ──────────────────────────────────────────────────────────────────
bookingSchema.pre("save", async function () {
  this._wasNew = this.isNew;

  // Phase 2: only fetch old doc when services actually changed.
  // _oldServiceDeltas = null signals post-save to skip all delta logic.
  if (!this.isNew) {
    if (this.isModified("services")) {
      const oldDoc = await this.constructor.findById(this._id).lean();
      this._oldServiceDeltas = oldDoc ? computeServiceDeltas(oldDoc) : new Map();
    } else {
      this._oldServiceDeltas = null;
    }
  }

  await assignBookingSequences(this);
  calculateBookingTotals(this);
});

// ── post-save ─────────────────────────────────────────────────────────────────
bookingSchema.post("save", async function () {
  try {
    const newDeltas = computeServiceDeltas(this);

    if (this._wasNew) {
      // New booking — apply full service deltas to each provider
      for (const [pid, delta] of newDeltas) {
        await applyProviderSummaryDelta(
          pid,
          { totalBuy: delta.buy, totalSell: delta.sell },
          "booking_save",  // Phase 4: source tag for SyncFailure records
        );
      }
    } else if (this._oldServiceDeltas !== null) {
      // Services were modified — apply only the diff
      const allProviderIds = new Set([
        ...newDeltas.keys(),
        ...(this._oldServiceDeltas?.keys() ?? []),
      ]);

      for (const pid of allProviderIds) {
        const oldD    = this._oldServiceDeltas.get(pid) || { buy: 0, sell: 0 };
        const newD    = newDeltas.get(pid)              || { buy: 0, sell: 0 };
        const diffBuy  = newD.buy  - oldD.buy;
        const diffSell = newD.sell - oldD.sell;

        if (diffBuy !== 0 || diffSell !== 0) {
          await applyProviderSummaryDelta(
            pid,
            { totalBuy: diffBuy, totalSell: diffSell },
            "booking_update",
          );
        }
      }
    }
    // _oldServiceDeltas === null → services unchanged → nothing to sync
  } catch (err) {
    // This catch covers errors in computeServiceDeltas or the iteration logic
    // itself. Individual applyProviderSummaryDelta failures are caught and
    // recorded internally — they don't propagate here.
    console.error("❌ booking.model post-save: unexpected error in sync loop:", err.message);
  }
});

// ── post-deleteOne ────────────────────────────────────────────────────────────
bookingSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    try {
      const deltas = computeServiceDeltas(this);
      for (const [pid, delta] of deltas) {
        await applyProviderSummaryDelta(
          pid,
          { totalBuy: -delta.buy, totalSell: -delta.sell },
          "booking_delete",
        );
      }
    } catch (err) {
      console.error("❌ booking.model post-delete: unexpected error in sync loop:", err.message);
    }
  },
);

export default mongoose.model("Booking", bookingSchema);
