import mongoose from "mongoose";

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
    accommodations: [
      {
        serviceNumber: Number,
        hotel: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Provider",
          required: true,
        },
        checkIn: Date,
        checkOut: Date,
        duration: Number,
        room: String,
        roomType: String,
        board: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    carRentals: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        brand: String,
        pickUp: Date,
        dropOff: Date,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    tripsWithDrivers: [
      {
        serviceNumber: Number,
        provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
        driverName: String,
        brand: String,
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 },
        profit: { type: Number, default: 0 },
      },
    ],
    totalPax: { adults: Number, kids: Number, total: Number },
  },
  { timestamps: true },
);

// FIX: Unique compound index prevents two simultaneous inserts from
// getting the same bookingID for the same provider (race condition).
// The DB will reject the duplicate and the caller will receive an error
// rather than silently producing ambiguous IDs.
bookingSchema.index({ provider: 1, bookingID: 1 }, { unique: true });

bookingSchema.pre("save", async function () {
  try {
    const Provider = mongoose.model("Provider");
    const Booking = mongoose.model("Booking");

    // ── Sequence / counter logic ─────────────────────────────────────────
    if (!this.isNew && this.isModified("provider")) {
      const oldDoc = await Booking.findById(this._id).lean();
      if (oldDoc && oldDoc.provider.toString() !== this.provider.toString()) {
        await Provider.findByIdAndUpdate(oldDoc.provider, {
          $inc: { currentSequence: -1, totalBookings: -1 },
        });
        const newP = await Provider.findByIdAndUpdate(
          this.provider,
          { $inc: { currentSequence: 1, totalBookings: 1 } },
          { new: true },
        );
        this.bookingID = newP.currentSequence;
      }
    }

    if (this.isNew) {
      const mainP = await Provider.findByIdAndUpdate(
        this.provider,
        { $inc: { currentSequence: 1, totalBookings: 1 } },
        { new: true },
      );
      if (!mainP) throw new Error("Main Provider not found");
      this.bookingID = mainP.currentSequence;
    }

    // ── Per-service sequence numbers ─────────────────────────────────────
    const processServices = async (fieldName, providerKey) => {
      if (!this[fieldName] || this[fieldName].length === 0) return;
      const oldDoc = !this.isNew
        ? await Booking.findById(this._id).lean()
        : null;

      for (let i = 0; i < this[fieldName].length; i++) {
        const item = this[fieldName][i];
        const currentPid = item[providerKey]?.toString();
        if (!currentPid) continue;

        if (!item.serviceNumber) {
          if (currentPid === this.provider.toString()) {
            this[fieldName][i].serviceNumber = this.bookingID;
          } else {
            const otherP = await Provider.findByIdAndUpdate(
              currentPid,
              { $inc: { currentSequence: 1 } },
              { new: true },
            );
            this[fieldName][i].serviceNumber = otherP
              ? otherP.currentSequence
              : 0;
          }
        } else if (item._id && oldDoc?.[fieldName]) {
          const oldItem = oldDoc[fieldName].find(
            (o) => o._id.toString() === item._id.toString(),
          );
          const oldPid = oldItem?.[providerKey]?.toString();
          if (oldPid && oldPid !== currentPid) {
            await Provider.findByIdAndUpdate(oldPid, {
              $inc: { currentSequence: -1 },
            });
            if (currentPid === this.provider.toString()) {
              this[fieldName][i].serviceNumber = this.bookingID;
            } else {
              const otherP = await Provider.findByIdAndUpdate(
                currentPid,
                { $inc: { currentSequence: 1 } },
                { new: true },
              );
              this[fieldName][i].serviceNumber = otherP
                ? otherP.currentSequence
                : 0;
            }
          }
        }
      }
    };

    await processServices("accommodations", "hotel");
    await processServices("carRentals", "provider");
    await processServices("tripsWithDrivers", "provider");

    this.markModified("accommodations");
    this.markModified("carRentals");
    this.markModified("tripsWithDrivers");

    // ── Auto-calculate hotel durations ───────────────────────────────────
    if (this.accommodations) {
      this.accommodations.forEach((acc) => {
        if (acc.checkIn && acc.checkOut) {
          acc.duration = Math.ceil(
            (new Date(acc.checkOut) - new Date(acc.checkIn)) /
              (1000 * 60 * 60 * 24),
          );
        }
      });
    }

    // ── Financial roll-up ────────────────────────────────────────────────
    let totalSell = 0;
    let totalBuy = 0;
    let totalProf = 0;

    const allServices = [
      ...(this.accommodations || []),
      ...(this.carRentals || []),
      ...(this.tripsWithDrivers || []),
    ];

    allServices.forEach((s) => {
      s.profit = (Number(s.sell) || 0) - (Number(s.buy) || 0);
      totalSell += Number(s.sell) || 0;
      totalBuy += Number(s.buy) || 0;
      totalProf += s.profit;
    });

    this.totalToPay = totalSell;
    this.totalToBuy = totalBuy;
    this.totalProfit = totalProf;
    this.remainingBalance = this.totalToPay - this.totalPaid;

    if (this.totalPaid <= 0) this.paymentStatus = "unpaid";
    else if (this.totalPaid >= this.totalToPay) this.paymentStatus = "paid";
    else this.paymentStatus = "partial";
  } catch (error) {
    throw error;
  }
});

export default mongoose.model("Booking", bookingSchema);
