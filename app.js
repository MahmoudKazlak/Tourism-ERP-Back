import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./DB/connection.js";
import * as indexRouter from "./src/modules/indexRouter.js";

dotenv.config({ path: "./config/.env" });

const REQUIRED_ENV = [
  "DBURI", "SIGNINTOKEN", "FORGOTPASSWORDTOKEN", "SALTROUND",
  "SENDEREMAIL", "SENDEREMAILPASSWORD",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app  = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.set("trust proxy", 1);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://localhost:4173"];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10kb" }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { success: false, message: "Too many requests from this IP, please try again later." },
  standardHeaders: true, legacyHeaders: false,
});

// Export shares the heavy limiter — it runs a full DB scan and is
// admin-only, so one request at a time per IP is entirely appropriate.
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { success: false, message: "Too many requests. Please wait before retrying." },
  standardHeaders: true, legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  message: { success: false, message: "Too many requests. Please slow down." },
  standardHeaders: true, legacyHeaders: false,
});

// ── DB ────────────────────────────────────────────────────────────────────────
connectDB();

// ── Routes ────────────────────────────────────────────────────────────────────
const baseUrl = process.env.BASEURL || "/api/v1";

app.use(`${baseUrl}/auth`,                authLimiter,    indexRouter.authRouter);
app.use(`${baseUrl}/view-board`,          heavyLimiter,   indexRouter.viewBoardRouter);
app.use(`${baseUrl}/report`,              heavyLimiter,   indexRouter.reportRouter);
// Export streams a full DB scan — treat it like a heavy aggregation endpoint
app.use(`${baseUrl}/export`,              heavyLimiter,   indexRouter.exportRouter);

app.use(`${baseUrl}/booking`,             generalLimiter, indexRouter.bookingRouter);
app.use(`${baseUrl}/booking`,             generalLimiter, indexRouter.paymentRouter);
app.use(`${baseUrl}/provider`,            generalLimiter, indexRouter.providerRouter);
app.use(`${baseUrl}/log`,                 generalLimiter, indexRouter.logRouter);
app.use(`${baseUrl}/statement`,           generalLimiter, indexRouter.statementRouter);
app.use(`${baseUrl}/voucher`,             generalLimiter, indexRouter.voucherRouter);
app.use(`${baseUrl}/expense`,             generalLimiter, indexRouter.expenseRouter);
app.use(`${baseUrl}/provider-payment`,    generalLimiter, indexRouter.providerPaymentRouter);
app.use(`${baseUrl}/provider-collection`, generalLimiter, indexRouter.providerCollectionRouter);
app.use(`${baseUrl}/office-settings`,     generalLimiter, indexRouter.officeSettingsRouter);
app.use(`${baseUrl}/service-types`,       generalLimiter, indexRouter.serviceTypeRouter);

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.cause || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Server Error",
    errors:  null,
    stack:   process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

export default app;
