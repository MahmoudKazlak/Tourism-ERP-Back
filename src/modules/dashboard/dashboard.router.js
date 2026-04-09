import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import * as dashboardController from "./controller/dashboard.controller.js";
import { endpoint } from "../indexEndpoint.js";

const router = Router();

router.get("/", auth(endpoint.booking_view), dashboardController.getDashboard);

export default router;
