import mongoose from "mongoose";

// Lazy model references to avoid circular-import issues
// (this module is imported by booking.model.js, which would
//  create a cycle if we imported the model directly here).
const getProvider = () => mongoose.model("Provider");
const getBooking = () => mongoose.model("Booking");

/**
 * Assigns bookingID and per-service sequence numbers.
 *
 * ── Key invariant (bookingID bug fix) ────────────────────────────────────────
 * `provider.currentSequence` is a HIGH-WATER MARK — it records the highest
 * bookingID ever issued for that provider.  It must NEVER be decremented.
 *
 * Previously, deleting a booking called `$inc: { currentSequence: -1 }`.
 * This caused the following sequence:
 *
 *   Create B1 → sequence=1, Create B2 → sequence=2, Create B3 → sequence=3
 *   Delete B2  → sequence decremented to 2          ← BUG
 *   Create B4  → sequence incremented to 3          ← DUPLICATE KEY ERROR
 *                because booking with bookingID=3 still exists!
 *
 * Fix: `currentSequence` increments on every new booking and NEVER decrements.
 * `totalBookings` is a separate statistics counter that CAN go up and down.
 *
 * ── Other fixes applied ───────────────────────────────────────────────────────
 * [FIX-1] serviceNumber == null check (not falsy `!item.serviceNumber`)
 *         so serviceNumber=0 is correctly preserved.
 * [FIX-2] oldDoc fetched ONCE, shared across all three processServices calls
 *         (was previously fetched up to 3× per save).
 * [FIX-3] Throw instead of silently falling back to serviceNumber=0 when a
 *         sub-provider ID does not exist in the database. Orphaned references
 *         now surface as errors rather than silent data corruption.
 *
 * @param {import('mongoose').Document} doc - The booking document being saved.
 */
export const assignBookingSequences = async (doc) => {
  const Provider = getProvider();
  const Booking = getBooking();

  // ── Main booking sequence (bookingID) ──────────────────────────────────────

  if (doc.isNew) {
    // Increment the high-water mark and capture the new value as this booking's ID.
    const mainProvider = await Provider.findByIdAndUpdate(
      doc.provider,
      { $inc: { currentSequence: 1, totalBookings: 1 } },
      { new: true },
    );
    if (!mainProvider) throw new Error("Main Provider not found");
    doc.bookingID = mainProvider.currentSequence;
  } else if (doc.isModified("provider")) {
    // The booking's main provider has been reassigned.
    // BUG FIX: do NOT decrement the old provider's currentSequence — the old
    // bookingID has already been permanently issued and the old booking document
    // still references it. Decrementing would cause the next booking on that
    // provider to collide with an existing ID.
    // We only decrement totalBookings (a stats counter, not an ID generator).
    const oldDoc = await Booking.findById(doc._id).lean();
    if (oldDoc && oldDoc.provider.toString() !== doc.provider.toString()) {
      await Provider.findByIdAndUpdate(oldDoc.provider, {
        $inc: { totalBookings: -1 }, // ← stats only; currentSequence untouched
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
  // FIX-2: One DB read shared across all three service-type processors.
  const oldDoc = !doc.isNew ? await Booking.findById(doc._id).lean() : null;

  const processServices = async (fieldName, providerKey) => {
    const services = doc[fieldName];
    if (!services || services.length === 0) return;

    for (let i = 0; i < services.length; i++) {
      const item = services[i];
      const currentProviderId = item[providerKey]?.toString();
      if (!currentProviderId) continue;

      const isMainProvider = currentProviderId === doc.provider.toString();

      // FIX-1: Explicit null/undefined check — 0 is falsy but a valid serviceNumber.
      if (item.serviceNumber == null) {
        // New service — assign a sequence number.
        if (isMainProvider) {
          doc[fieldName][i].serviceNumber = doc.bookingID;
        } else {
          const otherProvider = await Provider.findByIdAndUpdate(
            currentProviderId,
            { $inc: { currentSequence: 1 } },
            { new: true },
          );
          // FIX-3: Throw instead of silently storing serviceNumber=0.
          // An unresolvable provider reference means we have a referential
          // integrity violation — surface it as an error immediately.
          if (!otherProvider) {
            throw new Error(
              `Service provider ${currentProviderId} not found ` +
                `while assigning sequence for ${fieldName}[${i}]. ` +
                `Ensure all referenced providers exist before saving.`,
            );
          }
          doc[fieldName][i].serviceNumber = otherProvider.currentSequence;
        }
      } else if (item._id && oldDoc?.[fieldName]) {
        // Existing service — only re-sequence if its provider changed.
        const oldItem = oldDoc[fieldName].find(
          (o) => o._id.toString() === item._id.toString(),
        );
        const oldProviderId = oldItem?.[providerKey]?.toString();

        if (oldProviderId && oldProviderId !== currentProviderId) {
          // BUG FIX: Do NOT decrement the old sub-provider's currentSequence.
          // The serviceNumber that was already issued to the old provider is
          // permanent — decrementing causes the same duplicate-key risk.
          // (No action needed for the old provider.)

          if (isMainProvider) {
            doc[fieldName][i].serviceNumber = doc.bookingID;
          } else {
            const otherProvider = await Provider.findByIdAndUpdate(
              currentProviderId,
              { $inc: { currentSequence: 1 } },
              { new: true },
            );
            // FIX-3: Same as above — throw on missing provider.
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
