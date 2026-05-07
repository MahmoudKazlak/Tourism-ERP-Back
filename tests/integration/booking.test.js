/**
 * Integration tests — Booking module
 *
 * Updated for the unified `services` array schema.
 * All former named arrays (accommodations, carRentals, carWithDriver)
 * are now a single `booking.services[]` with a `serviceType` discriminator.
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

// ── 1. Mock external services BEFORE importing any app modules ────────────────

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
      sendMail: jest.fn().mockResolvedValue({ messageId: "test-message-id" }),
    }),
  },
}));

await jest.unstable_mockModule("../../src/services/cloudinary.js", () => ({
  uploadImage: jest.fn().mockResolvedValue({
    secure_url: "https://res.cloudinary.com/test/image/upload/test.jpg",
    public_id: "profiles/test",
  }),
  deleteImage: jest.fn().mockResolvedValue({ result: "ok" }),
}));

// ── 2. Dynamic imports AFTER mocks ────────────────────────────────────────────

const { default: request } = await import("supertest");
const { default: app } = await import("../setup/testApp.js");
const { connectTestDB, disconnectTestDB, clearCollections } =
  await import("../setup/db.js");
const {
  createProvider,
  createAdminWithToken,
  createBookingStaffWithToken,
  buildAccommodation,
  buildCarRental,
  buildCarWithDriver,
} = await import("../setup/factories.js");
const { default: providerModel } =
  await import("../../DB/model/provider.model.js");
const { default: bookingModel } =
  await import("../../DB/model/booking.model.js");
const { default: paymentModel } =
  await import("../../DB/model/payment.model.js");

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends POST /api/v1/booking/create with a minimal valid body.
 * No services by default — add via the `overrides.services` key.
 */
const postBooking = async (authHeader, providerId, overrides = {}) =>
  request(app)
    .post("/api/v1/booking/create")
    .set("Authorization", authHeader)
    .send({
      provider: providerId.toString(),
      customers: [{ name: "Hassan Eid", ageType: "adult" }],
      status: "pending",
      ...overrides,
    });

/**
 * Finds the first service of a given type inside booking.services[].
 */
const findService = (booking, serviceType) =>
  booking.services.find((s) => s.serviceType === serviceType);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authentication & Authorization
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard on booking routes", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const provider = await createProvider();
    const res = await request(app)
      .post("/api/v1/booking/create")
      .send({ provider: provider._id, customers: [{ name: "Test" }] });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("returns 401 when an invalid token is provided", async () => {
    const provider = await createProvider();
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", "Bearer invalid.jwt.token")
      .send({ provider: provider._id, customers: [{ name: "Test" }] });

    expect(res.status).toBe(401);
  });

  it("returns 403 when accounting_staff tries to create a booking", async () => {
    const { authHeader } = await createAdminWithToken({
      role: "accounting_staff",
    });
    const provider = await createProvider();
    const res = await postBooking(authHeader, provider._id);
    expect(res.status).toBe(403);
  });

  it("returns 403 when accounting_staff tries to delete a booking", async () => {
    const { authHeader: staffHeader } = await createAdminWithToken({
      role: "booking_staff",
    });
    const { authHeader: accountingHeader } = await createAdminWithToken({
      role: "accounting_staff",
    });
    const provider = await createProvider();

    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    const deleteRes = await request(app)
      .delete(`/api/v1/booking/delete/${bookingId}`)
      .set("Authorization", accountingHeader);

    expect(deleteRes.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Input Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Booking creation — input validation", () => {
  let authHeader;

  beforeEach(async () => {
    ({ authHeader } = await createBookingStaffWithToken());
  });

  it("returns 400 when provider field is missing", async () => {
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({ customers: [{ name: "Test User" }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/validation/i);
  });

  it("returns 400 when provider is not a valid ObjectId", async () => {
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({ provider: "not-an-object-id", customers: [{ name: "Test" }] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when customers array is empty", async () => {
    const provider = await createProvider();
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({ provider: provider._id, customers: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when customer name is too short (< 2 chars)", async () => {
    const provider = await createProvider();
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({ provider: provider._id, customers: [{ name: "A" }] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when accommodation checkOut is before checkIn", async () => {
    const provider = await createProvider();
    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: provider._id,
        customers: [{ name: "Test User" }],
        // controller-level validation catches reversed dates
        services: [
          {
            serviceType: "accommodation",
            provider: provider._id.toString(),
            buy: 100,
            sell: 150,
            details: {
              checkIn: "2025-06-10",
              checkOut: "2025-06-05", // before checkIn — invalid
            },
          },
        ],
      });

    // Controller's validateServiceDetails() returns 400
    expect(res.status).toBe(400);
  });

  it("returns 404 when the provider ObjectId is valid but does not exist in DB", async () => {
    const fakeId = new (await import("mongoose")).default.Types.ObjectId();
    const res = await postBooking(authHeader, fakeId);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/provider not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Provider Sequence Increment (Core Business Rule)
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider sequence — booking creation", () => {
  let authHeader;

  beforeEach(async () => {
    ({ authHeader } = await createBookingStaffWithToken());
  });

  it("increments provider.currentSequence by exactly 1 on booking creation", async () => {
    const provider = await createProvider({ currentSequence: 0 });

    const res = await postBooking(authHeader, provider._id);
    expect(res.status).toBe(201);

    const updated = await providerModel.findById(provider._id);
    expect(updated.currentSequence).toBe(1);
  });

  it("increments provider.totalBookings by exactly 1 on booking creation", async () => {
    const provider = await createProvider({ totalBookings: 0 });

    await postBooking(authHeader, provider._id);

    const updated = await providerModel.findById(provider._id);
    expect(updated.totalBookings).toBe(1);
  });

  it("bookingID in the response matches provider.currentSequence after creation", async () => {
    const provider = await createProvider({ currentSequence: 0 });

    const res = await postBooking(authHeader, provider._id);
    expect(res.status).toBe(201);

    const updated = await providerModel.findById(provider._id);
    expect(res.body.data.booking.bookingID).toBe(updated.currentSequence);
    expect(res.body.data.booking.bookingID).toBe(1);
  });

  it("produces consecutive bookingIDs for multiple bookings on the same provider", async () => {
    const provider = await createProvider();

    const res1 = await postBooking(authHeader, provider._id);
    const res2 = await postBooking(authHeader, provider._id);
    const res3 = await postBooking(authHeader, provider._id);

    expect(res1.body.data.booking.bookingID).toBe(1);
    expect(res2.body.data.booking.bookingID).toBe(2);
    expect(res3.body.data.booking.bookingID).toBe(3);

    const updated = await providerModel.findById(provider._id);
    expect(updated.currentSequence).toBe(3);
    expect(updated.totalBookings).toBe(3);
  });

  it("different providers maintain independent sequences", async () => {
    const providerA = await createProvider({ name: "Provider Alpha" });
    const providerB = await createProvider({ name: "Provider Beta" });

    await postBooking(authHeader, providerA._id);
    await postBooking(authHeader, providerA._id);
    await postBooking(authHeader, providerB._id);

    const updatedA = await providerModel.findById(providerA._id);
    const updatedB = await providerModel.findById(providerB._id);

    expect(updatedA.currentSequence).toBe(2);
    expect(updatedB.currentSequence).toBe(1);
  });

  it("does NOT increment provider.currentSequence when booking creation fails validation", async () => {
    const provider = await createProvider();
    const sequenceBefore = provider.currentSequence;

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({ provider: provider._id }); // missing customers

    expect(res.status).toBe(400);

    const updated = await providerModel.findById(provider._id);
    expect(updated.currentSequence).toBe(sequenceBefore);
  });

  it("does NOT increment provider.currentSequence when provider does not exist", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await postBooking(authHeader, fakeId);
    expect(res.status).toBe(404);

    const allProviders = await providerModel.find({});
    allProviders.forEach((p) => {
      expect(p.currentSequence).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Service Numbering
// ─────────────────────────────────────────────────────────────────────────────

describe("Service numbering", () => {
  let authHeader;

  beforeEach(async () => {
    ({ authHeader } = await createBookingStaffWithToken());
  });

  it("assigns serviceNumber = bookingID when service provider equals main provider", async () => {
    const hotel = await createProvider({ name: "Same Hotel", type: "hotel" });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: hotel._id.toString(),
        customers: [{ name: "Samer Khalil" }],
        services: [buildAccommodation(hotel._id)],
      });

    expect(res.status).toBe(201);

    const { booking } = res.body.data;
    expect(booking.services[0].serviceNumber).toBe(booking.bookingID);
  });

  it("assigns unique serviceNumber from sub-provider sequence when hotel differs from main provider", async () => {
    const tourOperator = await createProvider({
      name: "Tour Operator",
      type: "tourism",
    });
    const hotel = await createProvider({
      name: "Kempinski Hotel",
      type: "hotel",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: tourOperator._id.toString(),
        customers: [{ name: "Layla Ahmad" }],
        services: [buildAccommodation(hotel._id)],
      });

    expect(res.status).toBe(201);

    const updatedHotel = await providerModel.findById(hotel._id);
    expect(updatedHotel.currentSequence).toBe(1);

    const { booking } = res.body.data;
    expect(booking.services[0].serviceNumber).toBe(1);
  });

  it("assigns correct service numbers for mixed service types in one booking", async () => {
    const mainProvider = await createProvider({
      name: "Luxury Tours",
      type: "tourism",
    });
    const hotel = await createProvider({
      name: "W Hotel Amman",
      type: "hotel",
    });
    const carCo = await createProvider({
      name: "Hertz Jordan",
      type: "car_rental",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Omar Qasim" }],
        services: [buildAccommodation(hotel._id), buildCarRental(carCo._id)],
      });

    expect(res.status).toBe(201);

    const { booking } = res.body.data;

    const updatedHotel = await providerModel.findById(hotel._id);
    const updatedCar = await providerModel.findById(carCo._id);

    expect(updatedHotel.currentSequence).toBe(1);
    expect(updatedCar.currentSequence).toBe(1);

    expect(findService(booking, "accommodation").serviceNumber).toBe(1);
    expect(findService(booking, "carRental").serviceNumber).toBe(1);
  });

  it("assigns sequential service numbers for multiple services at the same hotel", async () => {
    const mainProvider = await createProvider({
      name: "Galaxy Tours",
      type: "tourism",
    });
    const hotel = await createProvider({ name: "Crowne Plaza", type: "hotel" });

    // First booking — hotel gets serviceNumber = 1
    await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Booking One" }],
        services: [buildAccommodation(hotel._id)],
      });

    // Second booking — hotel gets serviceNumber = 2
    const res2 = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Booking Two" }],
        services: [buildAccommodation(hotel._id)],
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.booking.services[0].serviceNumber).toBe(2);

    const updatedHotel = await providerModel.findById(hotel._id);
    expect(updatedHotel.currentSequence).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Financial Roll-up via API
// ─────────────────────────────────────────────────────────────────────────────

describe("Financial roll-up on booking creation", () => {
  let authHeader;

  beforeEach(async () => {
    ({ authHeader } = await createBookingStaffWithToken());
  });

  it("calculates correct totalToPay from accommodation sell prices", async () => {
    const provider = await createProvider({
      name: "Finance Test Hotel",
      type: "hotel",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Financial Test" }],
        services: [buildAccommodation(provider._id, { buy: 400, sell: 600 })],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.booking.totalToPay).toBe(600);
    expect(res.body.data.booking.totalToBuy).toBe(400);
    expect(res.body.data.booking.totalProfit).toBe(200);
  });

  it("calculates correct totals for a mixed booking (accommodation + car + carWithDriver)", async () => {
    const mainProvider = await createProvider({
      name: "Aqaba Tours",
      type: "tourism",
    });
    const hotel = await createProvider({
      name: "Aquamarina Hotel",
      type: "hotel",
    });
    const carCo = await createProvider({
      name: "Reliable Cars",
      type: "car_rental",
    });
    const driverCo = await createProvider({
      name: "Fast Drivers",
      type: "driver_company",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Farid Nassar" }],
        services: [
          buildAccommodation(hotel._id, { buy: 400, sell: 600 }),
          buildCarRental(carCo._id, { buy: 200, sell: 320 }),
          buildCarWithDriver(driverCo._id, { buy: 100, sell: 150 }),
        ],
      });

    expect(res.status).toBe(201);

    const { booking } = res.body.data;
    expect(booking.totalToPay).toBe(1070); // 600 + 320 + 150
    expect(booking.totalToBuy).toBe(700); // 400 + 200 + 100
    expect(booking.totalProfit).toBe(370); // 1070 - 700
  });

  it("sets paymentStatus to unpaid and remainingBalance = totalToPay on creation", async () => {
    const provider = await createProvider({
      name: "Initial Status Hotel",
      type: "hotel",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Status Check" }],
        services: [buildAccommodation(provider._id, { sell: 500 })],
      });

    expect(res.status).toBe(201);
    const { booking } = res.body.data;
    expect(booking.paymentStatus).toBe("unpaid");
    expect(booking.totalPaid).toBe(0);
    expect(booking.remainingBalance).toBe(booking.totalToPay);
  });

  it("calculates duration (nights) automatically from checkIn/checkOut in details", async () => {
    const provider = await createProvider({
      name: "Duration Hotel",
      type: "hotel",
    });

    const res = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", authHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Duration Test" }],
        services: [
          {
            serviceType: "accommodation",
            provider: provider._id.toString(),
            buy: 700,
            sell: 1050,
            details: {
              checkIn: "2025-06-01",
              checkOut: "2025-06-08", // 7 nights
            },
          },
        ],
      });

    expect(res.status).toBe(201);
    // duration is stored on the service item, not the booking root
    expect(res.body.data.booking.services[0].duration).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Booking Deletion
// ─────────────────────────────────────────────────────────────────────────────

describe("Booking deletion", () => {
  let adminHeader, staffHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
    ({ authHeader: staffHeader } = await createBookingStaffWithToken());
  });

  it("returns 403 when booking_staff tries to delete a booking", async () => {
    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    const deleteRes = await request(app)
      .delete(`/api/v1/booking/delete/${bookingId}`)
      .set("Authorization", staffHeader);

    expect(deleteRes.status).toBe(403);
  });

  it("does NOT decrement provider.currentSequence (high-water mark) when booking is deleted", async () => {
    const provider = await createProvider();

    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    const afterCreate = await providerModel.findById(provider._id);
    expect(afterCreate.currentSequence).toBe(1);

    await request(app)
      .delete(`/api/v1/booking/delete/${bookingId}`)
      .set("Authorization", adminHeader);

    const afterDelete = await providerModel.findById(provider._id);
    expect(afterDelete.currentSequence).toBe(1); // high-water mark preserved
    expect(afterDelete.totalBookings).toBe(0); // stat counter decremented
  });

  it("does NOT decrement sub-provider sequence when booking with service is deleted", async () => {
    const mainProvider = await createProvider({
      name: "Main Delete Tour",
      type: "tourism",
    });
    const hotel = await createProvider({
      name: "Hotel To Decrement",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Delete Test" }],
        services: [buildAccommodation(hotel._id)],
      });

    const bookingId = createRes.body.data.booking._id;

    const hotelAfterCreate = await providerModel.findById(hotel._id);
    expect(hotelAfterCreate.currentSequence).toBe(1);

    await request(app)
      .delete(`/api/v1/booking/delete/${bookingId}`)
      .set("Authorization", adminHeader);

    const hotelAfterDelete = await providerModel.findById(hotel._id);
    expect(hotelAfterDelete.currentSequence).toBe(1); // high-water mark preserved
  });

  it("also deletes associated payments when booking is deleted", async () => {
    const { user } = await createAdminWithToken();
    const provider = await createProvider();

    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;
    const numericBookingId = createRes.body.data.booking.bookingID;

    await paymentModel.create({
      booking: bookingId,
      bookingID: numericBookingId,
      amount: 100,
      method: "cash",
      recordedBy: user._id,
    });

    const paymentsBefore = await paymentModel.find({ booking: bookingId });
    expect(paymentsBefore).toHaveLength(1);

    await request(app)
      .delete(`/api/v1/booking/delete/${bookingId}`)
      .set("Authorization", adminHeader);

    const paymentsAfter = await paymentModel.find({ booking: bookingId });
    expect(paymentsAfter).toHaveLength(0);
  });

  it("returns 404 when trying to delete a non-existent booking", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/v1/booking/delete/${fakeId}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Read endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET booking endpoints", () => {
  let staffHeader, adminHeader;

  beforeEach(async () => {
    ({ authHeader: staffHeader } = await createBookingStaffWithToken());
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("GET /booking/getAll returns paginated bookings", async () => {
    const provider = await createProvider();

    await postBooking(staffHeader, provider._id);
    await postBooking(staffHeader, provider._id);

    const res = await request(app)
      .get("/api/v1/booking/getAll")
      .set("Authorization", staffHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCount).toBe(2);
    expect(res.body.data.bookings).toHaveLength(2);
  });

  it("GET /booking/getAll filters by numeric bookingID", async () => {
    const provider = await createProvider();

    await postBooking(staffHeader, provider._id);
    await postBooking(staffHeader, provider._id);

    const res = await request(app)
      .get("/api/v1/booking/getAll?bookingID=1")
      .set("Authorization", staffHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.totalCount).toBe(1);
    expect(res.body.data.bookings[0].bookingID).toBe(1);
  });

  it("GET /booking/getAll filters by serviceType", async () => {
    const provider = await createProvider({ type: "hotel" });
    const carCo = await createProvider({ type: "car_rental" });

    // Booking with accommodation
    await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Hotel Customer" }],
        services: [buildAccommodation(provider._id)],
      });

    // Booking with car rental only
    await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: carCo._id.toString(),
        customers: [{ name: "Car Customer" }],
        services: [buildCarRental(carCo._id)],
      });

    const res = await request(app)
      .get("/api/v1/booking/getAll?serviceType=accommodation")
      .set("Authorization", staffHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.totalCount).toBe(1);
  });

  it("GET /booking/getAll returns 400 for non-ObjectId provider filter", async () => {
    const res = await request(app)
      .get("/api/v1/booking/getAll?provider=not-valid")
      .set("Authorization", staffHeader);

    expect(res.status).toBe(400);
  });

  it("GET /booking/get/:id returns the booking with its services and payments", async () => {
    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    const res = await request(app)
      .get(`/api/v1/booking/get/${bookingId}`)
      .set("Authorization", staffHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.booking._id).toBe(bookingId);
    expect(res.body.data.payments).toBeDefined();
    expect(Array.isArray(res.body.data.booking.services)).toBe(true);
  });

  it("GET /booking/get/:id returns 404 for non-existent booking", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/booking/get/${fakeId}`)
      .set("Authorization", staffHeader);

    expect(res.status).toBe(404);
  });

  it("GET /booking/get/:id returns 400 for invalid MongoDB ObjectId", async () => {
    const res = await request(app)
      .get("/api/v1/booking/get/invalid-id")
      .set("Authorization", staffHeader);

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Booking Update
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /booking/edit/:id", () => {
  let staffHeader;

  beforeEach(async () => {
    ({ authHeader: staffHeader } = await createBookingStaffWithToken());
  });

  it("updates booking status successfully", async () => {
    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    const res = await request(app)
      .patch(`/api/v1/booking/edit/${bookingId}`)
      .set("Authorization", staffHeader)
      .send({ status: "confirmed" });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe("confirmed");
  });

  it("does NOT allow overwriting protected fields (bookingID, totalPaid)", async () => {
    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;
    const originalBookingID = createRes.body.data.booking.bookingID;

    await request(app)
      .patch(`/api/v1/booking/edit/${bookingId}`)
      .set("Authorization", staffHeader)
      .send({
        bookingID: 9999, // protected
        totalPaid: 9999, // protected
        status: "confirmed",
      });

    const updated = await bookingModel.findById(bookingId);
    expect(updated.bookingID).toBe(originalBookingID); // unchanged
    expect(updated.totalPaid).toBe(0); // unchanged
  });

  it("recalculates financial totals when service sell prices are updated", async () => {
    const provider = await createProvider({ type: "hotel" });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Finance Update" }],
        services: [buildAccommodation(provider._id, { buy: 400, sell: 600 })],
      });

    const bookingId = createRes.body.data.booking._id;

    const res = await request(app)
      .patch(`/api/v1/booking/edit/${bookingId}`)
      .set("Authorization", staffHeader)
      .send({
        services: [
          {
            serviceType: "accommodation",
            provider: provider._id.toString(),
            buy: 400,
            sell: 800, // updated sell price
            details: {
              checkIn: "2025-06-01",
              checkOut: "2025-06-05",
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.totalToPay).toBe(800);
    expect(res.body.data.booking.totalProfit).toBe(400);
  });

  it("returns 404 when updating a non-existent booking", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`/api/v1/booking/edit/${fakeId}`)
      .set("Authorization", staffHeader)
      .send({ status: "confirmed" });

    expect(res.status).toBe(404);
  });

  it("triggers status change notification (mock called) when status changes", async () => {
    mockNotifyStatusChanged.mockClear();

    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    await request(app)
      .patch(`/api/v1/booking/edit/${bookingId}`)
      .set("Authorization", staffHeader)
      .send({ status: "confirmed" });

    expect(mockNotifyStatusChanged).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger notification when status does not change", async () => {
    mockNotifyStatusChanged.mockClear();

    const provider = await createProvider();
    const createRes = await postBooking(staffHeader, provider._id);
    const bookingId = createRes.body.data.booking._id;

    await request(app)
      .patch(`/api/v1/booking/edit/${bookingId}`)
      .set("Authorization", staffHeader)
      .send({ customers: [{ name: "Updated Name", ageType: "adult" }] });

    expect(mockNotifyStatusChanged).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Add / Remove Service from Booking
// ─────────────────────────────────────────────────────────────────────────────

describe("Service management on existing bookings", () => {
  let staffHeader, adminHeader;

  beforeEach(async () => {
    ({ authHeader: staffHeader } = await createBookingStaffWithToken());
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("adds a car rental service to an existing booking and updates totals", async () => {
    const mainProvider = await createProvider({
      name: "Add Service Tour",
      type: "tourism",
    });
    const carCo = await createProvider({
      name: "Add Car Provider",
      type: "car_rental",
    });

    const createRes = await postBooking(staffHeader, mainProvider._id);
    const bookingId = createRes.body.data.booking._id;
    const totalBefore = createRes.body.data.booking.totalToPay; // 0 — no services

    const res = await request(app)
      .patch(`/api/v1/booking/${bookingId}/addService`)
      .set("Authorization", staffHeader)
      .send({
        serviceType: "carRental",
        provider: carCo._id.toString(),
        buy: 200,
        sell: 320,
        details: {
          brand: "Toyota Camry",
          pickUp: "2025-06-01",
          dropOff: "2025-06-05",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.totalToPay).toBe(320);
    expect(res.body.data.booking.totalToPay).toBeGreaterThan(totalBefore);
  });

  it("adds an apartRent service to an existing booking", async () => {
    const mainProvider = await createProvider({
      name: "Add Apt Tour",
      type: "tourism",
    });
    const aptProvider = await createProvider({
      name: "Apt Provider",
      type: "hotel",
    });

    const createRes = await postBooking(staffHeader, mainProvider._id);
    const bookingId = createRes.body.data.booking._id;

    const res = await request(app)
      .patch(`/api/v1/booking/${bookingId}/addService`)
      .set("Authorization", staffHeader)
      .send({
        serviceType: "apartRent",
        provider: aptProvider._id.toString(),
        buy: 350,
        sell: 500,
        details: {
          checkIn: "2025-08-01",
          checkOut: "2025-08-08",
          address: "Sweifieh District, Apt 5A",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.totalToPay).toBe(500);
    const added = findService(res.body.data.booking, "apartRent");
    expect(added).toBeDefined();
    expect(added.duration).toBe(7);
  });

  it("removes a service by serviceId and updates totals", async () => {
    const mainProvider = await createProvider({
      name: "Remove Service Tour",
      type: "tourism",
    });
    const hotel = await createProvider({
      name: "Hotel to Remove From",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: mainProvider._id.toString(),
        customers: [{ name: "Remove Test" }],
        services: [buildAccommodation(hotel._id)],
      });

    const bookingId = createRes.body.data.booking._id;
    // serviceId is the MongoDB _id of the service subdocument
    const serviceId = createRes.body.data.booking.services[0]._id;

    const hotelBefore = await providerModel.findById(hotel._id);
    expect(hotelBefore.currentSequence).toBe(1);

    const res = await request(app)
      .patch(`/api/v1/booking/${bookingId}/remove`)
      .set("Authorization", staffHeader)
      .send({ serviceId });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.services).toHaveLength(0);
    expect(res.body.data.booking.totalToPay).toBe(0);

    // High-water mark is never decremented
    const hotelAfter = await providerModel.findById(hotel._id);
    expect(hotelAfter.currentSequence).toBe(1);
  });

  it("does NOT decrement main provider sequence when removing a service with same provider", async () => {
    const hotel = await createProvider({
      name: "Same Hotel Remove",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: hotel._id.toString(),
        customers: [{ name: "Same Provider Remove" }],
        services: [buildAccommodation(hotel._id)],
      });

    const bookingId = createRes.body.data.booking._id;
    const serviceId = createRes.body.data.booking.services[0]._id;
    const sequenceBefore = (await providerModel.findById(hotel._id))
      .currentSequence;

    await request(app)
      .patch(`/api/v1/booking/${bookingId}/remove`)
      .set("Authorization", staffHeader)
      .send({ serviceId });

    const hotelAfter = await providerModel.findById(hotel._id);
    expect(hotelAfter.currentSequence).toBe(sequenceBefore); // unchanged
  });

  it("returns 404 when trying to remove a service that does not exist on the booking", async () => {
    const { default: mongoose } = await import("mongoose");
    const mainProvider = await createProvider();
    const createRes = await postBooking(staffHeader, mainProvider._id);
    const bookingId = createRes.body.data.booking._id;

    const res = await request(app)
      .patch(`/api/v1/booking/${bookingId}/remove`)
      .set("Authorization", staffHeader)
      .send({ serviceId: new mongoose.Types.ObjectId().toString() });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/service not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Payment integration
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment recording on a booking", () => {
  let staffHeader, adminHeader, user;

  beforeEach(async () => {
    ({ authHeader: staffHeader, user } = await createBookingStaffWithToken());
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("adds a payment and updates booking totalPaid and remainingBalance", async () => {
    const provider = await createProvider({
      name: "Payment Test Hotel",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Payment Customer" }],
        services: [buildAccommodation(provider._id, { sell: 1000 })],
      });

    const bookingId = createRes.body.data.booking._id;

    const payRes = await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 400, method: "cash" });

    expect(payRes.status).toBe(201);
    expect(payRes.body.data.bookingSummary.totalPaid).toBe(400);
    expect(payRes.body.data.bookingSummary.remainingBalance).toBe(600);
    expect(payRes.body.data.bookingSummary.paymentStatus).toBe("partial");
  });

  it('sets paymentStatus to "paid" when full amount is paid', async () => {
    const provider = await createProvider({
      name: "Full Pay Hotel",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Full Pay" }],
        services: [buildAccommodation(provider._id, { sell: 500 })],
      });

    const bookingId = createRes.body.data.booking._id;

    const payRes = await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 500, method: "bank_transfer" });

    expect(payRes.status).toBe(201);
    expect(payRes.body.data.bookingSummary.paymentStatus).toBe("paid");
    expect(payRes.body.data.bookingSummary.remainingBalance).toBe(0);
  });

  it("returns 400 when trying to add a payment to an already-paid booking", async () => {
    const provider = await createProvider({
      name: "Already Paid Hotel",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Already Paid" }],
        services: [buildAccommodation(provider._id, { sell: 300 })],
      });

    const bookingId = createRes.body.data.booking._id;

    await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 300 });

    const res = await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already fully paid/i);
  });

  it("recalculates balance correctly when a payment is deleted", async () => {
    const provider = await createProvider({
      name: "Delete Pay Hotel",
      type: "hotel",
    });

    const createRes = await request(app)
      .post("/api/v1/booking/create")
      .set("Authorization", staffHeader)
      .send({
        provider: provider._id.toString(),
        customers: [{ name: "Delete Pay" }],
        services: [buildAccommodation(provider._id, { sell: 1000 })],
      });

    const bookingId = createRes.body.data.booking._id;

    const pay1 = await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 400 });

    await request(app)
      .post(`/api/v1/booking/${bookingId}/payments`)
      .set("Authorization", staffHeader)
      .send({ amount: 300 });

    const paymentId = pay1.body.data.payment._id;

    const deleteRes = await request(app)
      .delete(`/api/v1/booking/payments/${paymentId}`)
      .set("Authorization", adminHeader);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.bookingSummary.totalPaid).toBe(300);
    expect(deleteRes.body.data.bookingSummary.remainingBalance).toBe(700);
    expect(deleteRes.body.data.bookingSummary.paymentStatus).toBe("partial");
  });
});
