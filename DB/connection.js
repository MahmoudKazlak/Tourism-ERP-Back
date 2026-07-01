import mongoose from "mongoose";
import { seedAdmin } from "./adminSeed.js";
import { refreshServiceTypeRegistry } from "../src/services/serviceTypeRegistry.js";
import "./model/syncFailure.model.js"; // ← ADD THIS: registers the SyncFailure schema at startup


/**
 * Establishes the MongoDB connection then runs startup tasks sequentially.
 *
 * Connection options:
 *   retryWrites: false — Required for standalone (non-replica-set) MongoDB
 *     deployments. MongoDB 4+ drivers enable retryable writes by default, but
 *     retryable writes require a replica set to be active. On a standalone
 *     instance the driver throws "does not support retryable writes" on the
 *     very first write operation. Setting this to false disables the feature
 *     for this connection without affecting any other behaviour.
 *     When you later deploy MongoDB as a replica set (recommended for
 *     production), you can remove this option or set it back to true.
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
    await refreshServiceTypeRegistry();
  } catch (err) {
    console.error("⚠️  Service type registry refresh failed:", err.message);
  }
};

export default connectDB;
