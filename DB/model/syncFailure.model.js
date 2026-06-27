import mongoose from "mongoose";

/**
 * SyncFailure — records every provider summary drift event.
 *
 * Problem being solved:
 *   Booking, ProviderPayment, and ProviderCollection post-save/post-delete
 *   hooks call applyProviderSummaryDelta() after the primary document is
 *   committed. If the delta update fails, the booking/payment is safely stored
 *   but the provider's summary.currentBalance is now wrong — silently.
 *
 *   Previously the only signal was a console.error line, which requires
 *   active log monitoring to catch. In a single-office deployment without
 *   dedicated DevOps, that line gets missed.
 *
 * What this model provides:
 *   - A queryable record of every drift event (source, provider, delta, error).
 *   - A `resolved` flag so admins can mark failures as fixed after running
 *     POST /api/v1/provider/:id/resync or POST /api/v1/provider/resync-all.
 *   - A TTL index that auto-deletes resolved failures after 30 days to avoid
 *     unbounded collection growth.
 *
 * How to use:
 *   // Find all unresolved failures (admin dashboard)
 *   await SyncFailure.find({ resolved: false }).populate("providerId", "name");
 *
 *   // After resync, mark resolved
 *   await SyncFailure.updateMany({ providerId }, { resolved: true, resolvedAt: new Date() });
 *
 * Multi-tenant note (Phase 5):
 *   Add tenantId field when moving to SaaS — failures are per-tenant.
 */
const syncFailureSchema = new mongoose.Schema(
  {
    // Which provider's summary drifted
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Provider",
      index: true,
    },
    // Which hook triggered the delta that failed
    // e.g. "booking_save" | "booking_delete" | "providerPayment_save" |
    //      "providerPayment_delete" | "providerCollection_save" | "providerCollection_delete"
    source: {
      type:     String,
      required: true,
    },
    // The delta object that was passed to applyProviderSummaryDelta —
    // stored so a developer can manually reconstruct the correct state if needed.
    delta: {
      type: mongoose.Schema.Types.Mixed,
    },
    // The error message from the failed DB operation
    errorMessage: {
      type:     String,
      required: true,
    },
    // Whether this failure has been fixed (manually or via resync endpoint)
    resolved: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    resolvedAt: {
      type:    Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound index for the most common admin query: unresolved by provider
syncFailureSchema.index({ providerId: 1, resolved: 1, createdAt: -1 });

// TTL: automatically remove resolved failures after 30 days.
// Unresolved failures (resolved: false) have resolvedAt = null, so they are
// never expired by this index — they persist until manually resolved.
syncFailureSchema.index(
  { resolvedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { resolved: true } },
);

export default mongoose.model("SyncFailure", syncFailureSchema);
