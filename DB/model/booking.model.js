import mongoose from "mongoose";
import {
  assignBookingSequences,
  calculateBookingTotals,
} from "../../src/services/bookingService.js";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "../../src/services/providerSummaryService.js";

const bookingSchema = new mongoose.Schema(
  {
    bookingID: Number,
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    totalToPay: { type: Number, default: 0 },
    totalToBuy: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
    },
    customers: [{ name: String, ageType: String }],
    accommodations: [
      {
        serviceNumber: Number,
        hotel: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Provider",
          required: true,
        },
        checkIn: Date,
        checkOut: Date,
        duration: Number,
        room: String,
        roomType: String,
        board: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    carRentals: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        brand: String,
        pickUp: Date,
        dropOff: Date,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    carWithDriver: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        driverName: String,
        brand: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true },
);

bookingSchema.index({ provider: 1, bookingID: 1 }, { unique: true });

// ─────────────────────────────────────────────────────────────────────────────
// pre-save
//   1. Run existing sequence + totals logic (unchanged).
//   2. If this is an UPDATE (not a new document), snapshot the OLD service
//      deltas from the DB so the post-save hook can diff new vs. old.
//      We store this on the document instance — it is never persisted.
// ─────────────────────────────────────────────────────────────────────────────
bookingSchema.pre("save", async function () {
  // Capture BEFORE the document is saved so post-save can compare
  this._wasNew = this.isNew;

  if (!this.isNew) {
    // Fetch the current persisted state before overwriting
    const oldDoc = await this.constructor.findById(this._id).lean();
    this._oldServiceDeltas = oldDoc ? computeServiceDeltas(oldDoc) : new Map();
  }

  // Existing business logic — order must be preserved
  await assignBookingSequences(this);
  calculateBookingTotals(this);
});

// ─────────────────────────────────────────────────────────────────────────────
// post-save
//   Apply incremental summary deltas to each affected provider.
//   New booking  → apply all service deltas as positive increments.
//   Updated booking → diff old vs. new and apply only the change.
// ─────────────────────────────────────────────────────────────────────────────
bookingSchema.post("save", async function () {
  try {
    const newDeltas = computeServiceDeltas(this);

    if (this._wasNew) {
      // Brand-new booking: every service is an addition
      for (const [pid, delta] of newDeltas) {
        await applyProviderSummaryDelta(pid, {
          totalBuy: delta.buy,
          totalSell: delta.sell,
        });
      }
    } else if (this._oldServiceDeltas) {
      // Updated booking: only push the diff so we don't double-count
      const allProviderIds = new Set([
        ...newDeltas.keys(),
        ...this._oldServiceDeltas.keys(),
      ]);

      for (const pid of allProviderIds) {
        const oldD = this._oldServiceDeltas.get(pid) || { buy: 0, sell: 0 };
        const newD = newDeltas.get(pid) || { buy: 0, sell: 0 };
        const diffBuy = newD.buy - oldD.buy;
        const diffSell = newD.sell - oldD.sell;

        if (diffBuy !== 0 || diffSell !== 0) {
          await applyProviderSummaryDelta(pid, {
            totalBuy: diffBuy,
            totalSell: diffSell,
          });
        }
      }
    }
  } catch (err) {
    // Never crash the booking operation — summary drift is recoverable
    console.error(
      "❌ Provider summary sync failed after booking save:",
      err.message,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// post-deleteOne (document middleware — triggered by doc.deleteOne())
//   Reverse all service deltas so provider summaries stay accurate.
// ─────────────────────────────────────────────────────────────────────────────
bookingSchema.post(
  "deleteOne",
  { document: true, query: false },
  async function () {
    try {
      const deltas = computeServiceDeltas(this);
      for (const [pid, delta] of deltas) {
        await applyProviderSummaryDelta(pid, {
          totalBuy: -delta.buy,
          totalSell: -delta.sell,
        });
      }
    } catch (err) {
      console.error(
        "❌ Provider summary sync failed after booking delete:",
        err.message,
      );
    }
  },
);

export default mongoose.model("Booking", bookingSchema);
