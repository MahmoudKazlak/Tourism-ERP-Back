import logModel     from "./model/log.model.js";
import userModel    from "./model/user.model.js";
import counterModel from "./model/counter.model.js";
import bookingModel from "./model/booking.model.js";

/**
 * Seeds the initial admin account and initialises the booking counter.
 *
 * Credentials are read from environment variables so they are never
 * committed to source control. Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD
 * in your .env file. Sensible defaults are provided for local development
 * only — override them in staging/production.
 */
export const seedAdmin = async () => {
  const seedEmail    = process.env.ADMIN_SEED_EMAIL    || "admin@system.com";
  const seedPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@123";

  const adminExists = await userModel.findOne({ role: "admin" });

  if (!adminExists) {
    console.log("🚀 No admin found. Creating initial admin account...");

    const user = await userModel.create({
      userName: "SuperAdmin",
      email:    seedEmail,
      password: seedPassword,
      role:     "admin",
    });

    await logModel.create({
      user:   user._id,
      action: "ADMIN_SEED",
      details: { userId: user._id, userName: user.userName },
    });

    console.log(`✅ Initial admin created: ${seedEmail}`);
    console.log("⚠️  Change the password immediately after first login!");
  }

  // ── Booking counter initialisation ─────────────────────────────────────────
  // Finds the highest bookingID in the DB so the counter never resets below
  // existing data. $max ensures this is a no-op if counter is already higher.
  const topBooking = await bookingModel
    .findOne({}, { bookingID: 1 })
    .sort({ bookingID: -1 })
    .lean();

  const currentMax = topBooking?.bookingID ?? 0;

  await counterModel.findOneAndUpdate(
    { _id: "booking" },
    { $max: { seq: currentMax } },
    { upsert: true },
  );

  if (currentMax > 0) {
    console.log(`ℹ️  Booking counter initialised to ${currentMax} (existing max ID).`);
  }
};
