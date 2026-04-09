import jwt from "jsonwebtoken";
import userModel from "../../DB/model/user.model.js";

export const auth = (accessRoles = []) => {
  return async (req, res, next) => {
    try {
      const { token } = req.headers;

      // FIX: كان بيـ crash لو ما في token
      if (!token) {
        return res.status(401).json({ message: "Token is required" });
      }

      if (!token.startsWith(process.env.BEARERKEY)) {
        return res.status(401).json({ message: "Invalid token format" });
      }

      const rawToken = token.split(process.env.BEARERKEY)[1];
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
