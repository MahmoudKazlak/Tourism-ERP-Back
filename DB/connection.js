import mongoose from "mongoose";
import { seedAdmin } from "./adminSeed.js";
import { refreshServiceTypeRegistry } from "../src/services/serviceTypeRegistry.js";

/**
 * Connects to MongoDB then runs startup tasks sequentially.
 *
 * Design decisions:
 *  - process.exit(1) on connection failure — a server with no DB is broken,
 *    not degraded. Fail loudly so the process manager restarts it.
 *  - seedAdmin and refreshServiceTypeRegistry run after the connection is
 *    confirmed, not inside the connect chain, so each step's errors are
 *    distinct and visible in logs.
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DBURI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }

  try {
    await seedAdmin();
  } catch (err) {
    console.error("❌ Admin seed failed:", err.message);
    process.exit(1);
  }

  try {
    await refreshServiceTypeRegistry();
  } catch (err) {
    // Non-fatal: the app can run without custom service types loaded,
    // but log it prominently so it gets noticed.
    console.error("⚠️  Service type registry refresh failed:", err.message);
  }
};

export default connectDB;
