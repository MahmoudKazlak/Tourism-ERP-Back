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

    // Standalone MongoDB instances reject transactions with this code.
    // In that case we retry without a session so the app still functions.
    // NOTE: without a transaction, the operations are no longer atomic.
    // For production use, always run MongoDB as a replica set.
    const isNoReplicaSetError =
      error?.codeName === "IllegalOperation" ||
      error?.message?.includes(
        "Transaction numbers are only allowed on a replica set",
      );

    if (isNoReplicaSetError) {
      console.warn(
        "⚠️  MongoDB transactions require a replica set. " +
          "Falling back to non-transactional execution. " +
          "Operations are NOT atomic in this mode.",
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
