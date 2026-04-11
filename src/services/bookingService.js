import mongoose from "mongoose";

// Lazy model references to avoid circular-import issues
// (this module is imported by booking.model.js, which would
//  create a cycle if we imported the model directly here).
const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");

/**
 * Assigns bookingID and per-service sequence numbers.
 *
 * Extracted from booking.model.js pre('save') for testability.
 *
 * Fixes applied here:
 *  [1] serviceNumber == null check instead of falsy !item.serviceNumber
 *      (0 is a theoretically valid serviceNumber and would have been skipped).
 *  [2] oldDoc fetched ONCE before the loop, not once per service-type
 *      (previously caused up to 3 redundant DB reads per save).
 *
 * @param {import('mongoose').Document} doc - The booking document being saved.
 */
export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking = getBooking();

  // ── Main booking sequence (bookingID) ──────────────────────────────────────
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
        $inc: { currentSequence: -1, totalBookings: -1 },
      });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { currentSequence: 1, totalBookings: 1 } },
        { new: true },
      );
      doc.bookingID = newProvider.currentSequence;
    }
  }

  // ── Per-service sequence numbers ──────────────────────────────────────────
  // FIX [2]: One DB read shared across all three service-type processors.
  const oldDoc = !doc.isNew ? await Booking.findById(doc._id).lean() : null;

  const processServices = async (fieldName, providerKey) => {
    const services = doc[fieldName];
    if (!services || services.length === 0) return;

    for (let i = 0; i < services.length; i++) {
      const item = services[i];
      const currentProviderId = item[providerKey]?.toString();
      if (!currentProviderId) continue;

      const isMainProvider = currentProviderId === doc.provider.toString();

      // FIX [1]: Explicit null/undefined check — 0 would fail a falsy ! check.
      if (item.serviceNumber == null) {
        // New service being added — assign sequence now.
        if (isMainProvider) {
          doc[fieldName][i].serviceNumber = doc.bookingID;
        } else {
          const otherProvider = await Provider.findByIdAndUpdate(
            currentProviderId,
            { $inc: { currentSequence: 1 } },
            { new: true },
          );
          doc[fieldName][i].serviceNumber = otherProvider?.currentSequence ?? 0;
        }
      } else if (item._id && oldDoc?.[fieldName]) {
        // Existing service — only re-sequence if its provider changed.
        const oldItem = oldDoc[fieldName].find(
          (o) => o._id.toString() === item._id.toString(),
        );
        const oldProviderId = oldItem?.[providerKey]?.toString();

        if (oldProviderId && oldProviderId !== currentProviderId) {
          await Provider.findByIdAndUpdate(oldProviderId, {
            $inc: { currentSequence: -1 },
          });
          if (isMainProvider) {
            doc[fieldName][i].serviceNumber = doc.bookingID;
          } else {
            const otherProvider = await Provider.findByIdAndUpdate(
              currentProviderId,
              { $inc: { currentSequence: 1 } },
              { new: true },
            );
            doc[fieldName][i].serviceNumber =
              otherProvider?.currentSequence ?? 0;
          }
        }
      }
    }
  };

  await processServices("accommodations", "hotel");
  await processServices("carRentals", "provider");
  await processServices("tripsWithDrivers", "provider");

  doc.markModified("accommodations");
  doc.markModified("carRentals");
  doc.markModified("tripsWithDrivers");
};

/**
 * Recalculates hotel stay durations and all booking financial totals.
 *
 * Pure synchronous — no DB calls. Safe to call multiple times.
 * Mutates the document directly.
 *
 * @param {import('mongoose').Document} doc - The booking document being saved.
 */
export const calculateBookingTotals = (doc) => {
  // Auto-calculate hotel stay durations.
  doc.accommodations?.forEach((acc) => {
    if (acc.checkIn && acc.checkOut) {
      acc.duration = Math.ceil(
        (new Date(acc.checkOut) - new Date(acc.checkIn)) /
          (1000 * 60 * 60 * 24),
      );
    }
  });

  // Roll up financials across all service types.
  let totalSell = 0;
  let totalBuy = 0;

  const allServices = [
    ...(doc.accommodations || []),
    ...(doc.carRentals || []),
    ...(doc.tripsWithDrivers || []),
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

  if ((doc.totalPaid || 0) <= 0) {
    doc.paymentStatus = "unpaid";
  } else if (doc.totalPaid >= doc.totalToPay) {
    doc.paymentStatus = "paid";
  } else {
    doc.paymentStatus = "partial";
  }
};
