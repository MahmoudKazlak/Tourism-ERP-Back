import { SERVICE_TYPES, SERVICE_TYPE_KEYS } from "../config/serviceTypes.js";
import OfficeServiceType from "../../DB/model/officeServiceType.model.js";

/**
 * In-process service type registry.
 *
 * Merges the built-in service types (defined statically in serviceTypes.js)
 * with office-defined custom types (stored in the OfficeServiceType collection)
 * into two module-level variables that are cheap to read on every request.
 *
 * ── Architecture constraint (important before scaling) ──────────────────────
 *
 * `mergedTypes` and `mergedKeys` are process-level singletons. This means:
 *
 *   Single process (current deployment): ✅ works correctly.
 *     refreshServiceTypeRegistry() is called after every mutating controller
 *     action (create/update/delete), so the registry stays current within
 *     the single Node process.
 *
 *   Multi-process (PM2 cluster / Node cluster): ⚠️ stale reads across workers.
 *     When an admin creates a service type in worker A, workers B/C/D still
 *     hold the old registry until they are individually refreshed or restarted.
 *
 *   Multi-tenant SaaS (Phase 5): ❌ must be replaced.
 *     A single flat registry cannot hold per-tenant custom service types.
 *     Each tenant needs their own isolated set of types.
 *
 * Pre-scaling action required:
 *   Option A (minimal change): add `refreshServiceTypeRegistry()` to a
 *     startup hook that all workers run, and accept eventual consistency
 *     (new types propagate after a rolling restart).
 *   Option B (proper fix): replace the module-level singleton with a Redis
 *     cache keyed by tenantId. getMergedServiceTypes(tenantId) becomes async
 *     but is always consistent across processes.
 *
 * The public API (getMergedServiceTypes / getMergedServiceTypeKeys) is kept
 * intentionally simple so callers don't need to change when Option B is
 * implemented — only this file changes.
 */

let mergedTypes = { ...SERVICE_TYPES };
let mergedKeys  = [...SERVICE_TYPE_KEYS];

/** Returns the merged map of all active service type definitions. */
export const getMergedServiceTypes    = () => mergedTypes;

/** Returns the flat array of all active service type keys. */
export const getMergedServiceTypeKeys = () => mergedKeys;

const shapeOfficeType = (doc) => ({
  key:            doc.key,
  label:          doc.label,
  voucherPrefix:  doc.voucherPrefix,
  durationFields: doc.durationFields?.from ? doc.durationFields : undefined,
  detailFields:   doc.detailFields ?? [],
  source:         "office",
});

/**
 * Rebuilds the in-process registry from the DB.
 * Call this after any create / update / delete on OfficeServiceType.
 */
export const refreshServiceTypeRegistry = async () => {
  const custom = await OfficeServiceType.find({ isActive: true }).lean();

  mergedTypes = { ...SERVICE_TYPES };
  for (const doc of custom) {
    mergedTypes[doc.key] = shapeOfficeType(doc);
  }
  mergedKeys = Object.keys(mergedTypes);
};

/**
 * Returns a serialisable snapshot of all types for the API response.
 * Used by GET /api/v1/service-types.
 */
export const listServiceTypesForApi = () => {
  const types = {};
  for (const key of mergedKeys) {
    const def     = mergedTypes[key];
    types[key] = {
      key,
      label:          def.label,
      voucherPrefix:  def.voucherPrefix,
      durationFields: def.durationFields ?? null,
      detailFields:   def.detailFields   ?? [],
      source:         SERVICE_TYPES[key] ? "builtin" : "office",
    };
  }
  return { types, keys: mergedKeys };
};
