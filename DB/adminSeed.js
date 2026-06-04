import logModel    from "./model/log.model.js";
import userModel    from "./model/user.model.js";
import counterModel from "./model/counter.model.js";
import bookingModel from "./model/booking.model.js";

export const seedAdmin = async () => {
  try {
    const adminExists = await userModel.findOne({ role: "admin" });

    if (!adminExists) {
      console.log("🚀 No admin found. Creating initial admin account...");

      const user = await userModel.create({
        userName: "SuperAdmin",
        email: "admin@system.com",
        password: "Admin@123",
        role: "admin",
      });

      await logModel.create({
        user: user._id,
        action: "ADMIN_SEED",
        details: { userId: user._id, userName: user.userName },
      });

      console.log("✅ Initial Admin created: admin@system.com / Admin@123");
      console.log("⚠️  Change the password immediately after first login!");
    }

    // ── Booking counter initialisation ────────────────────────────────────────
    // Find the highest bookingID currently in the database so the global counter
    // starts above any existing records. Uses $max so it never moves backwards.
    const topBooking = await bookingModel
      .findOne({}, { bookingID: 1 })
      .sort({ bookingID: -1 })
      .lean();

    const currentMax = topBooking?.bookingID ?? 0;

    await counterModel.findOneAndUpdate(
      { _id: "booking" },
      { $max: { seq: currentMax } }, // only sets if new value is larger
      { upsert: true },
    );

    if (currentMax > 0) {
      console.log(`ℹ️  Booking counter initialised to ${currentMax} (existing max ID).`);
    }
  } catch (error) {
    console.error("❌ Error in seed:", error);
  }
};
