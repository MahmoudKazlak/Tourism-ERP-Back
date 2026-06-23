import { Router } from "express";
import { auth } from "../../middleware/auth.js";
import { endpoint } from "../indexEndpoint.js";
import { downloadFullExport } from "./export.controller.js";

const router = Router();

// GET /api/v1/export/full  — Admin only
router.get("/full", auth(endpoint.AdminOnly), downloadFullExport);

export default router;
