import jwt from "jsonwebtoken";
import userModel from "../../DB/model/user.model.js";

export const auth = (accessRoles = []) => {
  return async (req, res, next) => {
    try {
      const { token } = req.headers;

      if (!token) {
        return res.status(401).json({ message: "Token is required" });
      }

      const bearerKey = process.env.BEARERKEY;

      if (!token.startsWith(bearerKey)) {
        return res.status(401).json({ message: "Invalid token format" });
      }

      // slice() safely strips the prefix regardless of whether the prefix
      // string happens to appear again inside the token itself.
      // split(bearerKey)[1] would break in that (admittedly unlikely) case.
      const rawToken = token.slice(bearerKey.length);

      if (!rawToken) {
        return res.status(401).json({ message: "Token is empty" });
      }

      const decoded = jwt.verify(rawToken, process.env.SIGNINTOKEN);

      if (!decoded?.id) {
        return res.status(401).json({ message: "Invalid token payload" });
      }

      const user = await userModel
        .findById(decoded.id)
        .select("_id role blocked");

      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (user.blocked) {
        return res.status(403).json({ message: "Account is blocked" });
      }

      if (!accessRoles.includes(user.role)) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token expired" });
      }
      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({ message: "Invalid token" });
      }
      return res.status(500).json({ message: "Server error" });
    }
  };
};
