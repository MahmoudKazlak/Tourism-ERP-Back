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

    // ── Case 8: B2B vs B2C ──────────────────────────────────────────────────
    // Immutable after creation — see PROTECTED_BOOKING_FIELDS in
    // booking.controller.js. Switching this post-creation would require
    // reconciling provider.summary.agency retroactively, which is out of
    // scope; lock it instead.
    bookingType: {
      type: String,
      enum: ["agency", "customer"],
      default: "customer",
      required: true,
      index: true,
    },
    // Agency bookings only. Display-only — never enters totalToPay/totalProfit.
    // Editable while paymentStatus !== "paid" (enforced in updateBooking).
    providerProfit: { type: Number, default: 0 },
    // Agency bookings only. Enters totalToPay/totalProfit (see bookingService.js).
    // Editable while paymentStatus !== "paid" (enforced in updateBooking).
    officeProfit: { type: Number, default: 0 },
    // Human-readable, immutable, generated once in pre-save as `KZ-${bookingID}`.
    // Real cross-model linkage still uses ObjectId refs (Payment.booking,
    // ProviderPayment.booking, ProviderCollection.booking) — this is display/search only.
    referenceCode: { type: String, default: null },

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

    services: [
      {
        serviceType: {
          type: String,
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
          type: mongoose.Schema.Types.ObjectId,
          ref: "Provider",
          required: true,
        },
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
        duration: Number,
        details: { type: mongoose.Schema.Types.Mixed, default: {} },
        notes: { type: String, default: "" },
      },
    ],

    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true, optimisticConcurrency: true },
);

bookingSchema.index({ provider: 1, bookingID: 1 }, { unique: true });
// sparse: legacy bookings created before this feature won't have a
// referenceCode until their next save — sparse avoids a unique-null collision.
bookingSchema.index({ referenceCode: 1 }, { unique: true, sparse: true });

// ── pre-save ──────────────────────────────────────────────────────────────────
bookingSchema.pre("save", async function () {
  this._wasNew = this.isNew;

  if (!this.isNew) {
    const oldDoc = await this.constructor.findById(this._id).lean();
    this._oldServiceDeltas = oldDoc ? computeServiceDeltas(oldDoc) : new Map();
    this._oldAgency = oldDoc
      ? {
          bookingType: oldDoc.bookingType,
          totalToPay: oldDoc.totalToPay,
          provider: oldDoc.provider,
        }
      : null;
  }

  await assignBookingSequences(this);
  calculateBookingTotals(this);

  if (this._wasNew && !this.referenceCode) {
    this.referenceCode = `KZ-${this.bookingID}`;
  }
});

// ── post-save ─────────────────────────────────────────────────────────────────
bookingSchema.post("save", async function () {
  try {
    const newDeltas = computeServiceDeltas(this);

    if (this._wasNew) {
      for (const [pid, delta] of newDeltas) {
        await applyProviderSummaryDelta(pid, {
          totalBuy: delta.buy,
          totalSell: delta.sell,
        });
      }

      if (this.bookingType === "agency" && this.provider) {
        await applyProviderSummaryDelta(
          this.provider,
          { agencyTotalInvoiced: this.totalToPay },
          "booking_save_agency_invoice_new",
        );
      }
    } else if (this._oldServiceDeltas) {
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

      // ── Agency invoice reconciliation ─────────────────────────────────────
      // bookingType is immutable post-creation, so only two cases exist:
      // (1) totalToPay changed (officeProfit or services edited) with the
      //     same main provider — push just the diff.
      // (2) the main provider itself was swapped (existing updateBooking flow
      //     already supports changing `provider` on any booking) — reverse old,
      //     apply new.
      const oldAgency = this._oldAgency;
      if (
        oldAgency?.bookingType === "agency" ||
        this.bookingType === "agency"
      ) {
        const oldProviderId = oldAgency?.provider?.toString();
        const newProviderId = this.provider?.toString();

        if (
          oldAgency?.bookingType === "agency" &&
          oldProviderId === newProviderId
        ) {
          const diff = this.totalToPay - (oldAgency.totalToPay || 0);
          if (diff !== 0) {
            await applyProviderSummaryDelta(
              newProviderId,
              { agencyTotalInvoiced: diff },
              "booking_save_agency_invoice_diff",
            );
          }
        } else {
          // KNOWN LIMITATION: swapping the main provider on an agency booking
          // reverses/reapplies the invoiced total but does NOT retroactively
          // move any already-recorded payments' agencyTotalReceived contribution
          // to the new provider. Avoid swapping the main provider on an agency
          // booking that already has payments recorded against it.
          if (oldAgency?.bookingType === "agency" && oldProviderId) {
            await applyProviderSummaryDelta(
              oldProviderId,
              { agencyTotalInvoiced: -(oldAgency.totalToPay || 0) },
              "booking_save_agency_invoice_reversal",
            );
          }
          if (this.bookingType === "agency" && newProviderId) {
            await applyProviderSummaryDelta(
              newProviderId,
              { agencyTotalInvoiced: this.totalToPay },
              "booking_save_agency_invoice_new",
            );
          }
        }
      }
    }
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
          totalBuy: -delta.buy,
          totalSell: -delta.sell,
        });
      }
      // Deletion is already restricted to paymentStatus === "unpaid" bookings
      // (see deleteBooking in booking.controller.js), so agencyTotalReceived
      // never needs reversing here — no payments could exist yet.
      if (this.bookingType === "agency" && this.provider) {
        await applyProviderSummaryDelta(
          this.provider,
          { agencyTotalInvoiced: -this.totalToPay },
          "booking_delete_agency_invoice_reversal",
        );
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
