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

    /**
     * Unified services array — replaces the former named arrays
     * (accommodations, carRentals, carWithDriver).
     *
     * serviceType drives all processing logic via the SERVICE_TYPES registry.
     * details holds every type-specific field (checkIn/checkOut, brand, etc.).
     *
     * Built-in types live in src/config/serviceTypes.js; office-defined
     * types are stored in OfficeServiceType and merged at runtime.
     */
    services: [
      {
        serviceType: {
          type:     String,
          required: true,
          validate: {
            validator(v) {
              return getMergedServiceTypeKeys().includes(v);
            },
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
        // Auto-calculated for service types that define durationFields
        duration: Number,
        // All type-specific fields (checkIn, checkOut, brand, driverName, etc.)
        details: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true },
);

bookingSchema.index({ provider: 1, bookingID: 1 }, { unique: true });

// ── pre-save ──────────────────────────────────────────────────────────────────
bookingSchema.pre("save", async function () {
  this._wasNew = this.isNew;

  if (!this.isNew) {
    // Performance fix (Phase 2):
    // Previously, findById() was called on EVERY booking update to snapshot
    // the old services for delta computation — even on saves that only changed
    // status, customers, or payment fields (where services are untouched).
    //
    // Now we only pay for the DB read when services are actually modified.
    // On a status-only change this skips the extra round-trip entirely.
    // _oldServiceDeltas = null signals post-save to skip delta logic too.
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
        await applyProviderSummaryDelta(pid, {
          totalBuy:  delta.buy,
          totalSell: delta.sell,
        });
      }
    } else if (this._oldServiceDeltas !== null) {
      // Existing booking with services modified — apply only the diff.
      // _oldServiceDeltas is null (not an empty Map) when services weren't
      // changed, so this block is skipped for non-service updates.
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
          await applyProviderSummaryDelta(pid, {
            totalBuy:  diffBuy,
            totalSell: diffSell,
          });
        }
      }
    }
    // else: _oldServiceDeltas === null → services unchanged → nothing to sync
  } catch (err) {
    console.error(
      "❌ Provider summary sync failed after booking save:",
      err.message,
    );
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
        await applyProviderSummaryDelta(pid, {
          totalBuy:  -delta.buy,
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
