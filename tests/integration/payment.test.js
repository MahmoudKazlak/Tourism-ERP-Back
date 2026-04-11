/**
 * Integration tests — Payment module
 * Covers add payment, get payments by booking, get all payments, delete payment.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  beforeEach,
} from "@jest/globals";

// ── Step 1: Register all mocks BEFORE any import() ───────────────────────────

const mockNotifyStatusChanged = jest.fn().mockResolvedValue(undefined);
const mockNotifyPayment = jest.fn().mockResolvedValue(undefined);
const mockNotifyProviderPayment = jest.fn().mockResolvedValue(undefined);

await jest.unstable_mockModule("../../src/services/notification.js", () => ({
  notifyBookingStatusChanged: mockNotifyStatusChanged,
  notifyPaymentRecorded: mockNotifyPayment,
  notifyProviderPaymentRecorded: mockNotifyProviderPayment,
}));

await jest.unstable_mockModule("nodemailer", () => ({
  default: {
    createTransport: jest.fn().mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({ messageId: "test-id" }),
    }),
  },
}));

await jest.unstable_mockModule("../../src/services/cloudinary.js", () => ({
  uploadImage: jest.fn().mockResolvedValue({
    secure_url: "https://res.cloudinary.com/test/test.jpg",
    public_id: "profiles/test",
  }),
  deleteImage: jest.fn().mockResolvedValue({ result: "ok" }),
}));

// ── Step 2: Dynamic imports AFTER mocks ──────────────────────────────────────

const { default: request } = await import("supertest");
const { default: app } = await import("../setup/testApp.js");
const { connectTestDB, disconnectTestDB, clearCollections } =
  await import("../setup/db.js");
const {
  createAdminWithToken,
  createBookingStaffWithToken,
  createProvider,
  buildAccommodation,
} = await import("../setup/factories.js");
const { default: bookingModel } =
  await import("../../DB/model/booking.model.js");
const { default: paymentModel } =
  await import("../../DB/model/payment.model.js");

// ── Step 3: Lifecycle ─────────────────────────────────────────────────────────

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BOOKING_BASE = "/api/v1/booking";

/**
 * Creates a booking with a single accommodation and returns { bookingId, authHeader }.
 * sell price defaults to 1000 so tests can make meaningful partial payments.
 */
const createBookingWithService = async (sellPrice = 1000) => {
  const { authHeader } = await createBookingStaffWithToken();
  const provider = await createProvider({ type: "hotel" });

  const res = await request(app)
    .post(`${BOOKING_BASE}/create`)
    .set("Authorization", authHeader)
    .send({
      provider: provider._id.toString(),
      customers: [{ name: "Payment Test Customer", ageType: "adult" }],
      accommodations: [
        buildAccommodation(provider._id, { sell: sellPrice, buy: 700 }),
      ],
    });

  return {
    bookingId: res.body.data.booking._id,
    bookingNumericId: res.body.data.booking.bookingID,
    authHeader,
  };
};

/** Records a payment on a booking and returns the supertest response. */
const addPayment = (bookingId, authHeader, body) =>
  request(app)
    .post(`${BOOKING_BASE}/${bookingId}/payments`)
    .set("Authorization", authHeader)
    .send(body);

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /booking/:id/payments
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment — POST /booking/:id/payments", () => {
  it("returns 201 with payment document on success", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await addPayment(bookingId, authHeader, {
      amount: 400,
      method: "cash",
      notes: "First instalment",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payment).toMatchObject({
      amount: 400,
      method: "cash",
    });
    expect(res.body.data.bookingSummary).toBeDefined();
  });

  it("changes paymentStatus from unpaid → partial after a partial payment", async () => {
    const { bookingId, authHeader } = await createBookingWithService(1000);

    await addPayment(bookingId, authHeader, { amount: 400 });

    const booking = await bookingModel.findById(bookingId);
    expect(booking.paymentStatus).toBe("partial");
    expect(booking.totalPaid).toBe(400);
    expect(booking.remainingBalance).toBe(600);
  });

  it("changes paymentStatus to paid when totalPaid >= totalToPay", async () => {
    const { bookingId, authHeader } = await createBookingWithService(500);

    const res = await addPayment(bookingId, authHeader, { amount: 500 });

    expect(res.status).toBe(201);
    expect(res.body.data.bookingSummary.paymentStatus).toBe("paid");
    expect(res.body.data.bookingSummary.remainingBalance).toBe(0);

    const booking = await bookingModel.findById(bookingId);
    expect(booking.paymentStatus).toBe("paid");
  });

  it("remainingBalance decreases correctly after payment", async () => {
    const { bookingId, authHeader } = await createBookingWithService(800);

    const res = await addPayment(bookingId, authHeader, { amount: 300 });

    expect(res.status).toBe(201);
    expect(res.body.data.bookingSummary.remainingBalance).toBe(500);
  });

  it("multiple payments accumulate — totalPaid equals sum of all", async () => {
    const { bookingId, authHeader } = await createBookingWithService(1000);

    await addPayment(bookingId, authHeader, { amount: 200 });
    await addPayment(bookingId, authHeader, { amount: 300 });
    await addPayment(bookingId, authHeader, { amount: 150 });

    const booking = await bookingModel.findById(bookingId);
    expect(booking.totalPaid).toBe(650);
    expect(booking.remainingBalance).toBe(350);
    expect(booking.paymentStatus).toBe("partial");
  });

  it("returns 400 when booking is already fully paid", async () => {
    const { bookingId, authHeader } = await createBookingWithService(300);

    await addPayment(bookingId, authHeader, { amount: 300 });
    const res = await addPayment(bookingId, authHeader, { amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already fully paid/i);
  });

  it("returns 404 when booking ID does not exist", async () => {
    const { authHeader } = await createBookingStaffWithToken();
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await addPayment(fakeId, authHeader, { amount: 100 });

    expect(res.status).toBe(404);
  });

  it("returns 400 when amount is missing", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await addPayment(bookingId, authHeader, { method: "cash" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is zero", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await addPayment(bookingId, authHeader, { amount: 0 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is negative", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await addPayment(bookingId, authHeader, { amount: -50 });

    expect(res.status).toBe(400);
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const { bookingId } = await createBookingWithService();

    const res = await request(app)
      .post(`${BOOKING_BASE}/${bookingId}/payments`)
      .send({ amount: 100 });

    expect(res.status).toBe(401);
  });

  it("triggers payment notification (mock called) on success", async () => {
    mockNotifyPayment.mockClear();
    const { bookingId, authHeader } = await createBookingWithService();

    await addPayment(bookingId, authHeader, { amount: 200 });

    expect(mockNotifyPayment).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /booking/:id/payments
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment — GET /booking/:id/payments", () => {
  it("returns 200 with array of payment documents for the booking", async () => {
    const { bookingId, authHeader } = await createBookingWithService();
    await addPayment(bookingId, authHeader, { amount: 250 });
    await addPayment(bookingId, authHeader, { amount: 100 });

    const res = await request(app)
      .get(`${BOOKING_BASE}/${bookingId}/payments`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments).toHaveLength(2);
    expect(res.body.data.totalPaid).toBe(350);
    expect(res.body.data.paymentsCount).toBe(2);
  });

  it("returns empty payments array when no payments have been recorded", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await request(app)
      .get(`${BOOKING_BASE}/${bookingId}/payments`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.payments).toHaveLength(0);
    expect(res.body.data.totalPaid).toBe(0);
  });

  it("returns 404 when booking does not exist", async () => {
    const { authHeader } = await createBookingStaffWithToken();
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`${BOOKING_BASE}/${fakeId}/payments`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(404);
  });

  it("accounting_staff can view payments (booking_view permission)", async () => {
    const { bookingId } = await createBookingWithService();
    const { authHeader: accHeader } = await createAdminWithToken({
      role: "accounting_staff",
    });

    const res = await request(app)
      .get(`${BOOKING_BASE}/${bookingId}/payments`)
      .set("Authorization", accHeader);

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /booking/payments/all  (accounting + admin)
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment — GET /booking/payments/all", () => {
  it("returns 200 with paginated payments and totalAmount", async () => {
    const { bookingId, authHeader } = await createBookingWithService();
    await addPayment(bookingId, authHeader, { amount: 300, method: "cash" });
    await addPayment(bookingId, authHeader, {
      amount: 200,
      method: "bank_transfer",
    });

    const { authHeader: adminHeader } = await createAdminWithToken();

    const res = await request(app)
      .get(`${BOOKING_BASE}/payments/all`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.totalAmount).toBe(500);
  });

  it("filters by payment method", async () => {
    const { bookingId, authHeader } = await createBookingWithService();
    await addPayment(bookingId, authHeader, { amount: 300, method: "cash" });
    await addPayment(bookingId, authHeader, {
      amount: 200,
      method: "bank_transfer",
    });

    const { authHeader: adminHeader } = await createAdminWithToken();

    const res = await request(app)
      .get(`${BOOKING_BASE}/payments/all?method=cash`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    res.body.data.payments.forEach((p) => {
      expect(p.method).toBe("cash");
    });
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .get(`${BOOKING_BASE}/payments/all`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DELETE /booking/payments/:paymentId  (admin only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment — DELETE /booking/payments/:paymentId", () => {
  it("deletes payment and recalculates booking totalPaid/paymentStatus", async () => {
    const { bookingId, authHeader } = await createBookingWithService(1000);
    const { authHeader: adminHeader } = await createAdminWithToken();

    const pay1Res = await addPayment(bookingId, authHeader, { amount: 400 });
    await addPayment(bookingId, authHeader, { amount: 300 });

    const paymentId = pay1Res.body.data.payment._id;

    const deleteRes = await request(app)
      .delete(`${BOOKING_BASE}/payments/${paymentId}`)
      .set("Authorization", adminHeader);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Only the 300 payment remains
    const booking = await bookingModel.findById(bookingId);
    expect(booking.totalPaid).toBe(300);
    expect(booking.remainingBalance).toBe(700);
    expect(booking.paymentStatus).toBe("partial");
  });

  it("sets paymentStatus back to unpaid when last payment is deleted", async () => {
    const { bookingId, authHeader } = await createBookingWithService(500);
    const { authHeader: adminHeader } = await createAdminWithToken();

    const payRes = await addPayment(bookingId, authHeader, { amount: 200 });
    const paymentId = payRes.body.data.payment._id;

    await request(app)
      .delete(`${BOOKING_BASE}/payments/${paymentId}`)
      .set("Authorization", adminHeader);

    const booking = await bookingModel.findById(bookingId);
    expect(booking.totalPaid).toBe(0);
    expect(booking.paymentStatus).toBe("unpaid");
  });

  it("returns 404 when payment does not exist", async () => {
    const { authHeader: adminHeader } = await createAdminWithToken();
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`${BOOKING_BASE}/payments/${fakeId}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(404);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { bookingId, authHeader } = await createBookingWithService();
    const payRes = await addPayment(bookingId, authHeader, { amount: 100 });
    const paymentId = payRes.body.data.payment._id;

    const res = await request(app)
      .delete(`${BOOKING_BASE}/payments/${paymentId}`)
      .set("Authorization", authHeader); // staff token, not admin

    expect(res.status).toBe(403);
  });

  it("verifies payment document is gone from DB after deletion", async () => {
    const { bookingId, authHeader } = await createBookingWithService();
    const { authHeader: adminHeader } = await createAdminWithToken();

    const payRes = await addPayment(bookingId, authHeader, { amount: 100 });
    const paymentId = payRes.body.data.payment._id;

    await request(app)
      .delete(`${BOOKING_BASE}/payments/${paymentId}`)
      .set("Authorization", adminHeader);

    const found = await paymentModel.findById(paymentId);
    expect(found).toBeNull();
  });
});
