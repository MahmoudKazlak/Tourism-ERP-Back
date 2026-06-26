import mongoose from "mongoose";
import { getMergedServiceTypes } from "./serviceTypeRegistry.js";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "./providerSummaryService.js";

const getProvider = () => mongoose.model("Provider");
const getBooking  = () => mongoose.model("Booking");
const getCounter  = () => mongoose.model("Counter");

/**
 * Assigns bookingID and per-provider serviceNumbers.
 *
 * bookingID  → global auto-increment counter (unique across ALL bookings).
 *              Sequence: 1, 2, 3, …
 *
 * serviceNumber → per-provider sequence.
 *   Each provider keeps their own currentSequence so a hotel's vouchers
 *   are numbered independently of the booking ID.
 *
 * provider.totalBookings   → stat counter (decremented on deletion).
 * provider.currentSequence → high-water mark (NEVER decremented).
 *
 * Performance fix (Phase 2):
 *   The original code ran one findByIdAndUpdate per service sequentially
 *   inside a for loop. A booking with 5 services across 3 providers required
 *   5 sequential DB round trips.
 *
 *   The new approach:
 *     1. Group services by unique provider ID → one update per provider.
 *     2. Increment currentSequence by the count of that provider's services
 *        in a single findByIdAndUpdate instead of one per service.
 *     3. Run all provider updates concurrently with Promise.all().
 *     4. Derive each service's number from the returned high-water mark.
 *
 *   Example: 5 services across 3 providers → 3 parallel DB calls (was 5 serial).
 *   Example: 3 services all from same provider → 1 DB call (was 3 serial).
 */
export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking  = getBooking();
  const Counter  = getCounter();

  if (doc.isNew) {
    // ── Global booking ID ──────────────────────────────────────────────────────
    const counter = await Counter.findOneAndUpdate(
      { _id: "booking" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    doc.bookingID = counter.seq;

    // Increment totalBookings on the main provider (stat only — not currentSequence)
    const mainProvider = await Provider.findByIdAndUpdate(
      doc.provider,
      { $inc: { totalBookings: 1 } },
      { new: true },
    );
    if (!mainProvider) throw new Error("Main Provider not found");

  } else if (doc.isModified("provider")) {
    // Provider swapped on an existing booking — adjust totalBookings on both sides
    const oldDoc = await Booking.findById(doc._id).lean();
    if (oldDoc && oldDoc.provider.toString() !== doc.provider.toString()) {
      await Provider.findByIdAndUpdate(oldDoc.provider, { $inc: { totalBookings: -1 } });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { totalBookings: 1 } },
        { new: true },
      );
      if (!newProvider) throw new Error("New provider not found");
    }
  }

  // ── Service numbers ───────────────────────────────────────────────────────────
  //
  // Group all services that still need a serviceNumber by their provider.
  // Key: provider ID string → Value: array of service indices in doc.services.
  //
  // This lets us fire ONE findByIdAndUpdate per unique provider instead of
  // one per service, and run them all concurrently with Promise.all().
  const services = doc.services || [];

  const pendingByProvider = {};
  services.forEach((svc, idx) => {
    if (!svc.provider || svc.serviceNumber != null) return; // already assigned
    const key = svc.provider.toString();
    if (!pendingByProvider[key]) pendingByProvider[key] = [];
    pendingByProvider[key].push(idx);
  });

  if (Object.keys(pendingByProvider).length > 0) {
    await Promise.all(
      Object.entries(pendingByProvider).map(async ([providerId, indices]) => {
        // Increment by the total number of services for this provider in one shot
        const updated = await Provider.findByIdAndUpdate(
          providerId,
          { $inc: { currentSequence: indices.length } },
          { new: true },
        );
        if (!updated) {
          throw new Error(
            `Service provider ${providerId} not found during sequence assignment`,
          );
        }

        // currentSequence is now the high-water mark after our increment.
        // The block we "claimed" is:
        //   [currentSequence - indices.length + 1 … currentSequence]
        // Assign in order of appearance in the services array.
        const base = updated.currentSequence - indices.length;
        indices.forEach((serviceIdx, i) => {
          doc.services[serviceIdx].serviceNumber = base + i + 1;
        });
      }),
    );
  }

  doc.markModified("services");
};

/**
 * Recalculates all financial totals from the services array.
 * Also auto-calculates duration for service types that define durationFields.
 */
export const calculateBookingTotals = (doc) => {
  (doc.services || []).forEach((service) => {
    const typeDef = getMergedServiceTypes()[service.serviceType];
    if (typeDef?.durationFields && service.details) {
      const fromVal = service.details[typeDef.durationFields.from];
      const toVal   = service.details[typeDef.durationFields.to];
      if (fromVal && toVal) {
        service.duration = Math.ceil(
          (new Date(toVal) - new Date(fromVal)) / (1000 * 60 * 60 * 24),
        );
      }
    }
  });

  let totalSell = 0;
  let totalBuy  = 0;

  (doc.services || []).forEach((service) => {
    service.profit  = (Number(service.sell) || 0) - (Number(service.buy) || 0);
    totalSell      += Number(service.sell) || 0;
    totalBuy       += Number(service.buy)  || 0;
  });

  doc.totalToPay       = totalSell;
  doc.totalToBuy       = totalBuy;
  doc.totalProfit      = totalSell - totalBuy;
  doc.remainingBalance = doc.totalToPay - (doc.totalPaid || 0);

  if ((doc.totalPaid || 0) <= 0)            doc.paymentStatus = "unpaid";
  else if (doc.totalPaid >= doc.totalToPay) doc.paymentStatus = "paid";
  else                                       doc.paymentStatus = "partial";
};
