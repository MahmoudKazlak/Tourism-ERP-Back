/**
 * Canonical role identifiers — single source of truth for the entire backend.
 *
 * Every consumer (validation schemas, middleware, controllers, seeders) imports
 * from here. Changing a role string means changing it in exactly one place.
 *
 * When a new role is added:
 *   1. Add it here.
 *   2. Add it to DB/model/user.model.js enum array (references ALL_ROLES).
 *   3. Update src/modules/indexEndpoint.js endpoint arrays.
 *   4. Mirror the change in the frontend src/config/roles.js.
 *
 * Multi-tenant note (Phase 5):
 *   A "tenant_owner" role will likely be needed to represent the admin of a
 *   single tenant (distinct from the platform "admin"). Add it here when that
 *   work begins — all access-control logic will pick it up automatically.
 */

export const ROLES = Object.freeze({
  ADMIN:            "admin",
  BOOKING_STAFF:    "booking_staff",
  ACCOUNTING_STAFF: "accounting_staff",
});

/** Flat array of all valid role strings — used in Mongoose enum and Joi valid(). */
export const ALL_ROLES = Object.values(ROLES);
