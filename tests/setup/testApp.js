/**
 * Test-only Express application.
 *
 * Mirrors app.js exactly EXCEPT it does not call connectDB().
 * Each integration test suite connects to the memory server itself
 * via connectTestDB() from tests/setup/db.js, giving us full control
 * over the connection lifecycle.
 *
 * WHY a separate file instead of importing app.js:
 *   app.js calls connectDB() at module load time. If we import it in tests,
 *   Mongoose tries to connect to DBURI immediately — before our memory server
 *   URI is necessarily ready. A separate file avoids that race condition.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRouter from "../../src/modules/auth/auth.router.js";
import bookingRouter from "../../src/modules/booking/booking.router.js";
import paymentRouter from "../../src/modules/payment/payment.router.js";
import providerRouter from "../../src/modules/provider/provider.router.js";
import logRouter from "../../src/modules/log/log.router.js";
import dashboardRouter from "../../src/modules/dashboard/dashboard.router.js";
import statementRouter from "../../src/modules/statement/statement.router.js";
import voucherRouter from "../../src/modules/voucher/voucher.router.js";
import expenseRouter from "../../src/modules/expense/expense.router.js";
import providerPaymentRouter from "../../src/modules/providerPayment/providerPayment.router.js";
import providerCollectionRouter from "../../src/modules/providerCollection/providerCollection.router.js";
import reportRouter from "../../src/modules/report/report.router.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10kb" }));

const baseUrl = "/api/v1";

app.use(`${baseUrl}/auth`, authRouter);
app.use(`${baseUrl}/booking`, bookingRouter);
app.use(`${baseUrl}/booking`, paymentRouter);
app.use(`${baseUrl}/provider`, providerRouter);
app.use(`${baseUrl}/log`, logRouter);
app.use(`${baseUrl}/dashboard`, dashboardRouter);
app.use(`${baseUrl}/statement`, statementRouter);
app.use(`${baseUrl}/voucher`, voucherRouter);
app.use(`${baseUrl}/expense`, expenseRouter);
app.use(`${baseUrl}/provider-payment`, providerPaymentRouter);
app.use(`${baseUrl}/provider-collection`, providerCollectionRouter);
app.use(`${baseUrl}/report`, reportRouter);

// Global error handler (mirrors app.js).
app.use((err, req, res, next) => {
  const status = err.cause || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Server Error",
    errors: null,
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

export default app;
