import mongoose from "mongoose";
import { seedAdmin, seedOfficeProvider } from "./adminSeed.js";
import { refreshServiceTypeRegistry } from "../src/services/serviceTypeRegistry.js";
import "./model/syncFailure.model.js"; // ← registers the SyncFailure schema at startup

/**
 * Establishes the MongoDB connection then runs startup tasks sequentially.
 *
 * Connection options:
 *   retryWrites: false — required for standalone (non-replica-set) MongoDB.
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DBURI, {
      retryWrites: false,
    });
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
    await seedOfficeProvider();
  } catch (err) {
    console.error("❌ Office provider seed failed:", err.message);
    process.exit(1);
  }

  try {
    await refreshServiceTypeRegistry();
  } catch (err) {
    console.error("⚠️  Service type registry refresh failed:", err.message);
  }
};

export default connectDB;
