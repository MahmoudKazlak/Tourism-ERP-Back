import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./DB/connection.js";
import * as indexRouter from "./src/modules/indexRouter.js";

dotenv.config({ path: "./config/.env" });

// ── Fail fast if any critical env var is absent ──────────────────────────────
// This prevents the app from starting in a broken state and producing cryptic
// runtime errors deep inside request handlers.
const REQUIRED_ENV = [
  "DBURI",
  "SIGNINTOKEN",
  "FORGOTPASSWORDTOKEN",
  "BEARERKEY",
  "SALTROUND",
  "SENDEREMAIL",
  "SENDEREMAILPASSWORD",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(
    `❌ Missing required environment variables: ${missingEnv.join(", ")}`,
  );
  console.error("   Add them to config/.env and restart.");
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

connectDB();

const baseUrl = process.env.BASEURL || "/api/v1";

app.use(`${baseUrl}/auth`, authLimiter, indexRouter.authRouter);
app.use(`${baseUrl}/booking`, indexRouter.bookingRouter);
app.use(`${baseUrl}/booking`, indexRouter.paymentRouter);
app.use(`${baseUrl}/provider`, indexRouter.providerRouter);
app.use(`${baseUrl}/log`, indexRouter.logRouter);
app.use(`${baseUrl}/dashboard`, indexRouter.dashboardRouter);
app.use(`${baseUrl}/statement`, indexRouter.statementRouter);
app.use(`${baseUrl}/voucher`, indexRouter.voucherRouter);
app.use(`${baseUrl}/expense`, indexRouter.expenseRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  const status = err.cause || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
