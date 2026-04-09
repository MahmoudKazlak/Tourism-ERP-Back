    import { Router } from "express";
    import * as logController from "./controller/log.controller.js";
    import { auth } from "../../middleware/auth.js";
    import { endpoint } from "../indexEndpoint.js";

    const router = Router();

    router.get("/", auth(endpoint.AdminOnly), logController.getAllLogs);

    router.get(
    "/user/:userId",
    auth(endpoint.AdminOnly),
    logController.getLogsByUser,
    );

    export default router;
