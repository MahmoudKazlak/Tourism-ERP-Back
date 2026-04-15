import mongoose from "mongoose";
import {
  applyProviderSummaryDelta,
  computeServiceDeltas,
} from "./providerSummaryService.js";

const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");

/**
 * Pre-save logic to capture old state for delta diffing
 */
export const handleBookingPreSave = async (doc) => {
  doc._wasNew = doc.isNew;
  if (!doc.isNew) {
    const oldDoc = await getBooking().findById(doc._id).lean();
    doc._oldServiceDeltas = oldDoc ? computeServiceDeltas(oldDoc) : new Map();
  }
};

/**
 * Post-save logic to update provider summaries
 */
// src/services/bookingService.js

export const handleBookingPostSave = async (doc) => {
  try {
    const newDeltas = computeServiceDeltas(doc);

    if (doc._wasNew) {
      for (const [pid, delta] of newDeltas) {
        await applyProviderSummaryDelta(pid, {
          totalBuy: delta.buy,  // الاسم المطابق لـ buildSummaryPipeline
          totalSell: delta.sell, // الاسم المطابق لـ buildSummaryPipeline
        });
      }
    } else if (doc._oldServiceDeltas) {
      const allProviderIds = new Set([
        ...newDeltas.keys(),
        ...doc._oldServiceDeltas.keys(),
      ]);

      for (const pid of allProviderIds) {
        const oldD = doc._oldServiceDeltas.get(pid) || { buy: 0, sell: 0 };
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
    console.error("❌ Provider summary sync failed:", err.message);
  }
};

/**
 * Delete logic to reverse provider summaries
 */
export const handleBookingDelete = async (doc) => {
  try {
    const deltas = computeServiceDeltas(doc);
    for (const [pid, delta] of deltas) {
      await applyProviderSummaryDelta(pid, {
        totalBuy: -delta.buy,
        totalSell: -delta.sell,
      });
    }
  } catch (err) {
    console.error("❌ Provider summary sync failed (Delete):", err.message);
  }
};

/**
 * Original Sequence logic (unchanged but cleaned)
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

  const processServices = async (fieldName, providerKey) => {
    const services = doc[fieldName];
    if (!services || services.length === 0) return;

    for (let i = 0; i < services.length; i++) {
      const item = services[i];
      const currentProviderId = item[providerKey]?.toString();
      if (!currentProviderId) continue;
      const isMainProvider = currentProviderId === doc.provider.toString();

      if (item.serviceNumber == null) {
        if (isMainProvider) {
          doc[fieldName][i].serviceNumber = doc.bookingID;
        } else {
          const otherProvider = await Provider.findByIdAndUpdate(
            currentProviderId,
            { $inc: { currentSequence: 1 } },
            { new: true },
          );
          doc[fieldName][i].serviceNumber = otherProvider.currentSequence;
        }
      }
    }
  };

  await processServices("accommodations", "hotel");
  await processServices("carRentals", "provider");
  await processServices("carWithDriver", "provider");
};

/**
 * Original Totals logic
 */
export const calculateBookingTotals = (doc) => {
  doc.accommodations?.forEach((acc) => {
    if (acc.checkIn && acc.checkOut) {
      acc.duration = Math.ceil(
        (new Date(acc.checkOut) - new Date(acc.checkIn)) /
          (1000 * 60 * 60 * 24),
      );
    }
  });

  let totalSell = 0;
  let totalBuy = 0;
  const allServices = [
    ...(doc.accommodations || []),
    ...(doc.carRentals || []),
    ...(doc.carWithDriver || []),
  ];

  allServices.forEach((service) => {
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
