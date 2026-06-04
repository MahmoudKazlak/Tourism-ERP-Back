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
 * Assigns bookingID and serviceNumbers.
 *
 * bookingID  → global auto-increment counter (unique across ALL bookings,
 *              regardless of provider). Sequence: 1, 2, 3, 4, …
 *
 * serviceNumber → still per service-provider sequence.
 *   Each provider keeps their own currentSequence so a hotel's vouchers
 *   are numbered 1, 2, 3, … independently of the booking ID.
 *
 * provider.totalBookings  → stat counter (decremented on deletion).
 * provider.currentSequence → service-numbering high-water mark (never decremented).
 */
export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking  = getBooking();
  const Counter  = getCounter();

  if (doc.isNew) {
    // ── Global booking ID ────────────────────────────────────────────────────
    const counter = await Counter.findOneAndUpdate(
      { _id: "booking" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    doc.bookingID = counter.seq;

    // Update provider stats (totalBookings only — currentSequence is for services)
    const mainProvider = await Provider.findByIdAndUpdate(
      doc.provider,
      { $inc: { totalBookings: 1 } },
      { new: true },
    );
    if (!mainProvider) throw new Error("Main Provider not found");

  } else if (doc.isModified("provider")) {
    // Provider changed on an existing booking — adjust totalBookings on both sides
    const oldDoc = await Booking.findById(doc._id).lean();
    if (oldDoc && oldDoc.provider.toString() !== doc.provider.toString()) {
      await Provider.findByIdAndUpdate(oldDoc.provider, { $inc: { totalBookings: -1 } });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { totalBookings: 1 } },
        { new: true },
      );
      if (!newProvider) throw new Error("New provider not found");
      // bookingID stays unchanged when provider is swapped
    }
  }

  // ── Service numbers ───────────────────────────────────────────────────────
  // Every service (including those whose provider is the main booking provider)
  // gets a number from that service-provider's own sequence.
  const services = doc.services || [];
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    if (!service.provider) continue;
    if (service.serviceNumber != null) continue; // already assigned — preserve

    const svcProvider = await Provider.findByIdAndUpdate(
      service.provider,
      { $inc: { currentSequence: 1 } },
      { new: true },
    );
    if (!svcProvider) {
      throw new Error(
        `Service provider ${service.provider} not found during sequence assignment`,
      );
    }
    doc.services[i].serviceNumber = svcProvider.currentSequence;
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
    service.profit = (Number(service.sell) || 0) - (Number(service.buy) || 0);
    totalSell     += Number(service.sell) || 0;
    totalBuy      += Number(service.buy)  || 0;
  });

  doc.totalToPay      = totalSell;
  doc.totalToBuy      = totalBuy;
  doc.totalProfit     = totalSell - totalBuy;
  doc.remainingBalance = doc.totalToPay - (doc.totalPaid || 0);

  if ((doc.totalPaid || 0) <= 0)             doc.paymentStatus = "unpaid";
  else if (doc.totalPaid >= doc.totalToPay)  doc.paymentStatus = "paid";
  else                                        doc.paymentStatus = "partial";
};
