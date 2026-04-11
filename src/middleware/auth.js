import jwt from "jsonwebtoken";
import userModel from "../../DB/model/user.model.js";

/**
 * Authentication middleware factory.
 *
 * FIX [10]: Migrated from a custom `token` header with a `BEARERKEY` prefix
 * to the industry-standard `Authorization: Bearer <jwt>` header.
 * This is compatible with all HTTP clients, Swagger UIs, and browser
 * fetch/axios defaults without extra configuration.
 *
 * @param {string[]} accessRoles - Roles allowed to access the route.
 */
export const auth = (accessRoles = []) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Authorization header is required (Bearer token)",
        });
      }

      // Slice off "Bearer " (7 chars) — safe even if the JWT itself
      // contains the string "Bearer".
      const rawToken = authHeader.slice(7).trim();

      if (!rawToken) {
        return res
          .status(401)
          .json({ success: false, message: "Token is empty" });
      }

      const decoded = jwt.verify(rawToken, process.env.SIGNINTOKEN);

      if (!decoded?.id) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid token payload" });
      }

      const user = await userModel
        .findById(decoded.id)
        .select("_id role blocked email userName");

      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      }

      if (user.blocked) {
        return res
          .status(403)
          .json({ success: false, message: "Account is blocked" });
      }

      if (!accessRoles.includes(user.role)) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ success: false, message: "Token expired" });
      }
      if (error.name === "JsonWebTokenError") {
        return res
          .status(401)
          .json({ success: false, message: "Invalid token" });
      }
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
};
