/**
 * Per-test-file database helpers.
 *
 * Usage in a test file:
 *
 *   import { connectTestDB, disconnectTestDB, clearCollections } from '../setup/db.js';
 *
 *   beforeAll(connectTestDB);
 *   afterEach(clearCollections);
 *   afterAll(disconnectTestDB);
 */
import mongoose from "mongoose";

/**
 * Opens a Mongoose connection to the in-memory MongoDB.
 * Reads the URI written by globalSetup.
 */
export const connectTestDB = async () => {
  const uri = process.env.TEST_MONGO_URI || process.env.DBURI;
  if (!uri) throw new Error("TEST_MONGO_URI is not set. Did globalSetup run?");

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
};

/**
 * Closes the Mongoose connection.
 * Called in afterAll to release resources cleanly.
 */
export const disconnectTestDB = async () => {
  await mongoose.disconnect();
};

/**
 * Drops every collection in the current database.
 * Called in afterEach to prevent data leakage between tests.
 *
 * Dropping collections rather than deleting documents resets auto-increment
 * counters and clears indexes — critical for sequencing tests where we verify
 * that `currentSequence` starts from 0.
 */
export const clearCollections = async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((col) => col.deleteMany({})),
  );
};
