import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./DB/connection.js";
import * as indexRouter from "./src/modules/indexRouter.js";

dotenv.config({ path: "./config/.env" });

// ── Fail fast: abort startup if any critical env var is absent ───────────────
const REQUIRED_ENV = [
  "DBURI",
  "SIGNINTOKEN",
  "FORGOTPASSWORDTOKEN",
  "SALTROUND",
  "SENDEREMAIL",
  "SENDEREMAILPASSWORD",
  // Cloudinary — required for image uploads
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
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());

// Trust the first proxy hop (e.g. Nginx, Railway, Render).
app.set("trust proxy", 1);

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

// Rate limiter for auth endpoints — brute force protection.
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

// ── Route registration ────────────────────────────────────────────────────────
app.use(`${baseUrl}/auth`, authLimiter, indexRouter.authRouter);
app.use(`${baseUrl}/booking`, indexRouter.bookingRouter);
app.use(`${baseUrl}/booking`, indexRouter.paymentRouter);
app.use(`${baseUrl}/provider`, indexRouter.providerRouter);
app.use(`${baseUrl}/log`, indexRouter.logRouter);
app.use(`${baseUrl}/dashboard`, indexRouter.dashboardRouter);
app.use(`${baseUrl}/statement`, indexRouter.statementRouter);
app.use(`${baseUrl}/voucher`, indexRouter.voucherRouter);
app.use(`${baseUrl}/expense`, indexRouter.expenseRouter);
// ProviderPayment: money paid OUT to providers for their services
app.use(`${baseUrl}/provider-payment`, indexRouter.providerPaymentRouter);
// ProviderCollection: money collected BACK from providers who held our funds
app.use(`${baseUrl}/provider-collection`, indexRouter.providerCollectionRouter);
app.use(`${baseUrl}/report`, indexRouter.reportRouter);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.cause || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Server Error",
    errors: null,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
