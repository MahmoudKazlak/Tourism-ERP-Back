import mongoose from "mongoose";

const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");

/**
 * Assigns bookingID and per-service sequence numbers.
 * See inline comments for the high-water-mark invariant.
 *
 * Field renamed: tripsWithDrivers → carWithDriver
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
        $inc: { totalBookings: -1 },
      });
      const newProvider = await Provider.findByIdAndUpdate(
        doc.provider,
        { $inc: { currentSequence: 1, totalBookings: 1 } },
        { new: true },
      );
      if (!newProvider) throw new Error("New Provider not found");
      doc.bookingID = newProvider.currentSequence;
    }
  }

  // ── Per-service sequence numbers ──────────────────────────────────────────
  const oldDoc = !doc.isNew ? await Booking.findById(doc._id).lean() : null;

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
          if (!otherProvider) {
            throw new Error(
              `Service provider ${currentProviderId} not found ` +
                `while assigning sequence for ${fieldName}[${i}].`,
            );
          }
          doc[fieldName][i].serviceNumber = otherProvider.currentSequence;
        }
      } else if (item._id && oldDoc?.[fieldName]) {
        const oldItem = oldDoc[fieldName].find(
          (o) => o._id.toString() === item._id.toString(),
        );
        const oldProviderId = oldItem?.[providerKey]?.toString();

        if (oldProviderId && oldProviderId !== currentProviderId) {
          if (isMainProvider) {
            doc[fieldName][i].serviceNumber = doc.bookingID;
          } else {
            const otherProvider = await Provider.findByIdAndUpdate(
              currentProviderId,
              { $inc: { currentSequence: 1 } },
              { new: true },
            );
            if (!otherProvider) {
              throw new Error(
                `Service provider ${currentProviderId} not found ` +
                  `while re-sequencing ${fieldName}[${i}].`,
              );
            }
            doc[fieldName][i].serviceNumber = otherProvider.currentSequence;
          }
        }
      }
    }
  };

  await processServices("accommodations", "hotel");
  await processServices("carRentals", "provider");
  await processServices("carWithDriver", "provider"); // renamed

  doc.markModified("accommodations");
  doc.markModified("carRentals");
  doc.markModified("carWithDriver"); // renamed
};

/**
 * Recalculates hotel stay durations and all booking financial totals.
 * Pure synchronous — no DB calls.
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
    ...(doc.carWithDriver || []), // renamed
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
