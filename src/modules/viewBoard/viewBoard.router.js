import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as viewBoardController from "./controller/viewBoard.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

/**
 * GET /api/v1/view-board/providers?period=today
 *
 * Returns ALL providers (even those with no activity in the period),
 * each with their service lines, period stats, and all-time summary.
 * Also includes overall booking aggregates, status distributions, and metrics.
 *
 * period values:
 *   today | yesterday | last3days | last4days | last5days | last6days |
 *   thisweek | thismonth | last3months | last6months | lastyear | all
 */
router.get(
  "/providers",
  auth(endpoint.booking_view),
  viewBoardController.getAllProviders,
);

/**
 * GET /api/v1/view-board/active-services?period=today
 *
 * Returns ONLY providers that have at least one service in the period,
 * each with their service lines and period stats.
 * No allTimeSummary. Includes period-level counts and metrics.
 *
 * Same period values as above.
 */
router.get(
  "/active-services",
  auth(endpoint.booking_view),
  viewBoardController.getActiveServices,
);

export default router;
