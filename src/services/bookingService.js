import mongoose from "mongoose";
import { getMergedServiceTypes } from "./serviceTypeRegistry.js";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "./providerSummaryService.js";

const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");
const getCounter = () => mongoose.model("Counter");

export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking = getBooking();
  const Counter = getCounter();

  if (doc.isNew) {
    const counter = await Counter.findOneAndUpdate(
      { _id: "booking" },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true },
    );
    doc.bookingID = counter.seq;

    const mainProvider = await Provider.findByIdAndUpdate(
      doc.provider,
      { $inc: { totalBookings: 1 } },
      { returnDocument: "after" },
    );
    if (!mainProvider) throw new Error("Main Provider not found");
  } else if (doc.isModified("provider")) {
    const oldDoc = await Booking.findById(doc._id).lean();
    if (oldDoc && oldDoc.provider.toString() !== doc.provider.toString()) {
      await Provider.findByIdAndUpdate(oldDoc.provider, {
        $inc: { totalBookings: -1 },
      });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { totalBookings: 1 } },
        { returnDocument: "after" },
      );
      if (!newProvider) throw new Error("New provider not found");
    }
  }

  const services = doc.services || [];
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    if (!service.provider) continue;
    if (service.serviceNumber != null) continue;

    const svcProvider = await Provider.findByIdAndUpdate(
      service.provider,
      { $inc: { currentSequence: 1 } },
      { returnDocument: "after" },
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
 *
 * Case 8 (B2B/B2C) branching:
 *   bookingType === "agency":
 *     totalToPay  = Σ(service.sell) + officeProfit
 *     totalProfit = (Σ(service.sell) - Σ(service.buy)) + officeProfit
 *     providerProfit is NEVER added to either figure — it's the agency's own
 *     cut of what they charged the end customer, which we have no accounting
 *     claim on; stored purely for reporting/display.
 *   bookingType === "customer" (default, unchanged from before Case 8):
 *     totalToPay  = Σ(service.sell)
 *     totalProfit = Σ(service.sell) - Σ(service.buy)
 */
export const calculateBookingTotals = (doc) => {
  (doc.services || []).forEach((service) => {
    const typeDef = getMergedServiceTypes()[service.serviceType];
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

  const officeProfit =
    doc.bookingType === "agency" ? Number(doc.officeProfit) || 0 : 0;

  doc.totalToBuy = totalBuy;
  doc.totalToPay = totalSell + officeProfit;
  doc.totalProfit = totalSell - totalBuy + officeProfit;
  doc.remainingBalance = doc.totalToPay - (doc.totalPaid || 0);

  if ((doc.totalPaid || 0) <= 0) doc.paymentStatus = "unpaid";
  else if (doc.totalPaid >= doc.totalToPay) doc.paymentStatus = "paid";
  else doc.paymentStatus = "partial";
};
