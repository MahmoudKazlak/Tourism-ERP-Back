import mongoose from "mongoose";

/**
 * Executes `callback` inside a Mongoose transaction when a replica set is
 * available. Falls back to a plain (non-transactional) execution on
 * standalone MongoDB instances (common in dev/small deployments).
 *
 * The callback receives `session | null`. All Mongoose operations inside the
 * callback should pass the session through — Mongoose silently ignores a
 * null session, so the same callback body works in both modes.
 *
 * Standalone detection covers two distinct error surfaces:
 *
 *   1. "Transaction numbers are only allowed on a replica set member"
 *      Thrown by session.startTransaction() when MongoDB is standalone.
 *
 *   2. "This MongoDB deployment does not support retryable writes"
 *      Thrown by the MongoDB driver before a transaction even starts when
 *      retryable writes are enabled (the default in MongoDB driver 3+) on a
 *      standalone instance. Adding retryWrites=false to the connection string
 *      prevents this error upstream, but the fallback is kept here as a
 *      second line of defence in case the connection option is not set.
 *
 * ⚠️  Without a transaction, the operations inside the callback are NOT atomic.
 *     For production, always run MongoDB as a replica set.
 *
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export const withTransaction = async (callback) => {
  let session = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const result = await callback(session);

    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {
        // Swallow abort errors — the original error is what matters.
      }
    }

    // Detect any "standalone MongoDB" condition regardless of which layer
    // surfaces the error first.
    const isStandaloneError =
      error?.codeName === "IllegalOperation" ||
      error?.code === 20 ||
      error?.message?.includes(
        "Transaction numbers are only allowed on a replica set",
      ) ||
      error?.message?.includes("does not support retryable writes") ||
      error?.message?.includes("retryWrites");

    if (isStandaloneError) {
      console.warn(
        "⚠️  MongoDB transactions are not available on this deployment " +
          "(standalone instance detected). " +
          "Falling back to non-transactional execution. " +
          "Operations are NOT atomic in this mode. " +
          "Add retryWrites=false to your connection string and run MongoDB " +
          "as a replica set for full transaction support.",
      );
      return callback(null);
    }

    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};
