import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./DB/connection.js";
import * as indexRouter from "./src/modules/indexRouter.js";

dotenv.config({ path: "./config/.env" });

const REQUIRED_ENV = [
  "DBURI",
  "SIGNINTOKEN",
  "FORGOTPASSWORDTOKEN",
  "SALTROUND",
  "SENDEREMAIL",
  "SENDEREMAILPASSWORD",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(
    `❌ Missing required environment variables: ${missingEnv.join(", ")}`,
  );
  console.error("   Add them to config/.env and restart.");
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.set("trust proxy", 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Set ALLOWED_ORIGINS in config/.env as a comma-separated list.
// Example:  ALLOWED_ORIGINS=http://localhost:5173,https://myapp.com
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://localhost:4173"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, mobile apps, curl)
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10kb" }));

// ── Rate limiters ─────────────────────────────────────────────────────────────

/**
 * Auth endpoints — strict, prevents brute-force login attempts.
 * 100 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Heavy aggregation endpoints (viewBoard, reports).
 * These run multi-collection DB aggregations — protect against DB overload.
 * 30 requests per minute per IP.
 */
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many requests. Please wait before refreshing dashboards.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API limiter — applied to all other routes.
 * 120 requests per minute per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── DB connection ─────────────────────────────────────────────────────────────
connectDB();

// ── Routes ────────────────────────────────────────────────────────────────────
const baseUrl = process.env.BASEURL || "/api/v1";

// Auth — strictest limiter (brute-force protection)
app.use(`${baseUrl}/auth`, authLimiter, indexRouter.authRouter);

// Heavy aggregation — moderate limiter (DB protection)
app.use(`${baseUrl}/view-board`, heavyLimiter, indexRouter.viewBoardRouter);
app.use(`${baseUrl}/report`, heavyLimiter, indexRouter.reportRouter);

// All other routes — general limiter
app.use(`${baseUrl}/booking`, generalLimiter, indexRouter.bookingRouter);
app.use(`${baseUrl}/booking`, generalLimiter, indexRouter.paymentRouter);
app.use(`${baseUrl}/provider`, generalLimiter, indexRouter.providerRouter);
app.use(`${baseUrl}/log`, generalLimiter, indexRouter.logRouter);
app.use(`${baseUrl}/statement`, generalLimiter, indexRouter.statementRouter);
app.use(`${baseUrl}/voucher`, generalLimiter, indexRouter.voucherRouter);
app.use(`${baseUrl}/expense`, generalLimiter, indexRouter.expenseRouter);
app.use(
  `${baseUrl}/provider-payment`,
  generalLimiter,
  indexRouter.providerPaymentRouter,
);
app.use(
  `${baseUrl}/provider-collection`,
  generalLimiter,
  indexRouter.providerCollectionRouter,
);
app.use(
  `${baseUrl}/service-types`,
  generalLimiter,
  indexRouter.serviceTypeRouter,
);
app.use(
  `${baseUrl}/office-settings`,
  generalLimiter,
  indexRouter.officeSettingsRouter,
);

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.cause || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Server Error",
    errors: null,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
