import { ROLES } from "../config/roles.js";

/**
 * Endpoint access-control groups.
 *
 * Each group is an array of role strings passed to auth() middleware.
 * Using named groups (e.g. endpoint.AdminOnly) instead of inline arrays
 * means a permission change requires editing exactly one line here — no
 * need to hunt down every router file.
 *
 * Roles come from src/config/roles.js — the single source of truth.
 * Never inline role strings ("admin", "booking_staff") in router files.
 */
export const endpoint = {
  // ── Booking ─────────────────────────────────────────────────────────────────
  booking_manage: [ROLES.ADMIN, ROLES.BOOKING_STAFF],
  booking_view:   [ROLES.ADMIN, ROLES.BOOKING_STAFF, ROLES.ACCOUNTING_STAFF],
  booking_delete: [ROLES.ADMIN],

  // ── Provider ─────────────────────────────────────────────────────────────────
  provider_manage: [ROLES.ADMIN],
  provider_view:   [ROLES.ADMIN, ROLES.BOOKING_STAFF, ROLES.ACCOUNTING_STAFF],

  // ── Finance ──────────────────────────────────────────────────────────────────
  accounting_only: [ROLES.ADMIN, ROLES.ACCOUNTING_STAFF],

  // ── Cross-cutting ─────────────────────────────────────────────────────────────
  AdminOnly: [ROLES.ADMIN],
  All:       [ROLES.ADMIN, ROLES.BOOKING_STAFF, ROLES.ACCOUNTING_STAFF],
  view_logs: [ROLES.ADMIN],
};
