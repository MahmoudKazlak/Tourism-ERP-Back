/**
 * Integration tests — Voucher invoice PDF
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
} from "@jest/globals";

await jest.unstable_mockModule("../../src/services/notification.js", () => ({
  notifyBookingStatusChanged: jest.fn().mockResolvedValue(undefined),
  notifyPaymentRecorded: jest.fn().mockResolvedValue(undefined),
  notifyProviderPaymentRecorded: jest.fn().mockResolvedValue(undefined),
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

const { default: request } = await import("supertest");
const { default: app } = await import("../setup/testApp.js");
const { connectTestDB, disconnectTestDB, clearCollections } =
  await import("../setup/db.js");
const {
  createBookingStaffWithToken,
  createProvider,
  buildAccommodation,
} = await import("../setup/factories.js");

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

const BOOKING_BASE = "/api/v1/booking";
const VOUCHER_BASE = "/api/v1/voucher";

const createBookingWithService = async () => {
  const { authHeader } = await createBookingStaffWithToken();
  const provider = await createProvider({ type: "hotel" });

  const res = await request(app)
    .post(`${BOOKING_BASE}/create`)
    .set("Authorization", authHeader)
    .send({
      provider: provider._id.toString(),
      customers: [{ name: "Invoice PDF Customer", ageType: "adult" }],
      totalPax: { adults: 2, kids: 1 },
      services: [
        buildAccommodation(provider._id, { sell: 1200, buy: 800 }),
      ],
    });

  return {
    bookingId: res.body.data.booking._id,
    authHeader,
  };
};

describe("Voucher — GET /invoice/:bookingId/pdf", () => {
  it("returns a PDF binary stream with correct headers", async () => {
    const { bookingId, authHeader } = await createBookingWithService();

    const res = await request(app)
      .get(`${VOUCHER_BASE}/invoice/${bookingId}/pdf`)
      .set("Authorization", authHeader)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="INV-\d+-\d+\.pdf"/,
    );
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("returns 404 when booking does not exist", async () => {
    const { authHeader } = await createBookingStaffWithToken();
    const fakeId = "507f1f77bcf86cd799439011";

    const res = await request(app)
      .get(`${VOUCHER_BASE}/invoice/${fakeId}/pdf`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 401 without auth token", async () => {
    const { bookingId } = await createBookingWithService();

    const res = await request(app).get(
      `${VOUCHER_BASE}/invoice/${bookingId}/pdf`,
    );

    expect(res.status).toBe(401);
  });
});
