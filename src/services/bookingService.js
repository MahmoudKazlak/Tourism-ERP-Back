import mongoose from "mongoose";
import { SERVICE_TYPES } from "../config/serviceTypes.js";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "./providerSummaryService.js";

const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");

/**
 * Assigns bookingID and serviceNumbers to a new or updated booking document.
 *
 * Rules:
 *  - New booking: increment mainProvider.currentSequence → bookingID
 *  - Per service with no serviceNumber yet:
 *      same provider as booking.provider → serviceNumber = bookingID
 *      different provider               → increment that provider's sequence
 */
export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking = getBooking();

  if (doc.isNew) {
    const mainProvider = await Provider.findByIdAndUpdate(
      doc.provider,
      { $inc: { currentSequence: 1, totalBookings: 1 } },
      { new: true },
    );
    if (!mainProvider) throw new Error("Main Provider not found");
    doc.bookingID = mainProvider.currentSequence;
  } else if (doc.isModified("provider")) {
    const oldDoc = await Booking.findById(doc._id).lean();
    if (oldDoc && oldDoc.provider.toString() !== doc.provider.toString()) {
      await Provider.findByIdAndUpdate(oldDoc.provider, {
        $inc: { totalBookings: -1 },
      });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { currentSequence: 1, totalBookings: 1 } },
        { new: true },
      );
      doc.bookingID = newProvider.currentSequence;
    }
  }

  const services = doc.services || [];
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    if (!service.provider) continue;
    if (service.serviceNumber != null) continue; // already assigned — preserve

    const isMainProvider =
      service.provider.toString() === doc.provider.toString();

    if (isMainProvider) {
      doc.services[i].serviceNumber = doc.bookingID;
    } else {
      const otherProvider = await Provider.findByIdAndUpdate(
        service.provider,
        { $inc: { currentSequence: 1 } },
        { new: true },
      );
      if (!otherProvider) {
        throw new Error(
          `Service provider ${service.provider} not found during sequence assignment`,
        );
      }
      doc.services[i].serviceNumber = otherProvider.currentSequence;
    }
  }

  doc.markModified("services");
};

/**
 * Recalculates all financial totals from the services array.
 * Also auto-calculates duration for service types that define durationFields.
 */
export const calculateBookingTotals = (doc) => {
  // Auto-calculate duration for services whose type defines date range fields
  (doc.services || []).forEach((service) => {
    const typeDef = SERVICE_TYPES[service.serviceType];
    if (typeDef?.durationFields && service.details) {
      const fromVal = service.details[typeDef.durationFields.from];
      const toVal = service.details[typeDef.durationFields.to];
      if (fromVal && toVal) {
        service.duration = Math.ceil(
          (new Date(toVal) - new Date(fromVal)) / (1000 * 60 * 60 * 24),
        );
      }
    }
  });

  let totalSell = 0;
  let totalBuy = 0;

  (doc.services || []).forEach((service) => {
    service.profit = (Number(service.sell) || 0) - (Number(service.buy) || 0);
    totalSell += Number(service.sell) || 0;
    totalBuy += Number(service.buy) || 0;
  });

  doc.totalToPay = totalSell;
  doc.totalToBuy = totalBuy;
  doc.totalProfit = totalSell - totalBuy;
  doc.remainingBalance = doc.totalToPay - (doc.totalPaid || 0);

  if ((doc.totalPaid || 0) <= 0) doc.paymentStatus = "unpaid";
  else if (doc.totalPaid >= doc.totalToPay) doc.paymentStatus = "paid";
  else doc.paymentStatus = "partial";
};

// ── Kept for backward-compatibility with booking.model.js hooks ───────────────
export { computeServiceDeltas, applyProviderSummaryDelta };
