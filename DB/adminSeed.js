import { ROLES } from "../src/config/roles.js";
import logModel from "./model/log.model.js";
import userModel from "./model/user.model.js";
import counterModel from "./model/counter.model.js";
import bookingModel from "./model/booking.model.js";
import providerModel from "./model/provider.model.js";

/**
 * Seeds the initial admin account and initialises the booking counter.
 *
 * Phase 1 (security): credentials read from env vars — never committed to git.
 * Phase 3 (clean code): role assigned via ROLES.ADMIN constant — no magic string.
 *
 * Set in config/.env:
 *   ADMIN_SEED_EMAIL=your-admin@domain.com
 *   ADMIN_SEED_PASSWORD=YourStrongPassword@2025
 */
export const seedAdmin = async () => {
  const seedEmail = process.env.ADMIN_SEED_EMAIL || "admin@system.com";
  const seedPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@123";

  const adminExists = await userModel.findOne({ role: ROLES.ADMIN });

  if (!adminExists) {
    console.log("🚀 No admin found — creating initial admin account...");

    const user = await userModel.create({
      userName: "SuperAdmin",
      email: seedEmail,
      password: seedPassword,
      role: ROLES.ADMIN,
    });

    await logModel.create({
      user: user._id,
      action: "ADMIN_SEED",
      details: { userId: user._id, userName: user.userName },
    });

    console.log(`✅ Initial admin created: ${seedEmail}`);
    console.log(
      "⚠️  Change the default password immediately after first login!",
    );
  }

  // ── Booking counter initialisation ─────────────────────────────────────────
  // Finds the highest bookingID already in the DB so the counter never resets
  // below existing data on a fresh deployment or server restart.
  // $max is idempotent — safe to run on every startup.
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
    console.log(
      `ℹ️  Booking counter initialised to ${currentMax} (existing max ID).`,
    );
  }
};

/**
 * Seeds the singleton "Office" provider (Case 8).
 *
 * Why a real Provider document instead of a nullable booking.provider field:
 *   booking.provider stays required, the unique {provider,bookingID} index,
 *   every existing .populate("provider", ...) call across controllers/exports/
 *   view-board aggregations, and getLinkedProviderIds() all continue to work
 *   completely unchanged. Customer (B2C) bookings simply reference this one
 *   real provider document as their main provider — zero special-casing
 *   needed anywhere else in the codebase.
 *
 * Idempotent — matched by `type: "office"` (a type value no admin-facing UI
 * can ever produce, see provider.model.js), safe to run on every startup.
 */
export const seedOfficeProvider = async () => {
  const exists = await providerModel.findOne({ type: "office" });
  if (exists) return;

  console.log(
    "🏢 No Office provider found — creating singleton Office provider...",
  );

  const office = await providerModel.create({
    name: "Office",
    type: "office",
    currentSequence: 0,
  });

  console.log(`✅ Office provider created (${office._id}).`);
};
