/**
 * Integration tests — Provider module
 * Covers create, getAll, getById, update, delete providers.
 * Validates role-based access and the "cannot delete linked provider" business rule.
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
  buildCarRental,
  buildTrip,
} = await import("../setup/factories.js");
const { default: providerModel } =
  await import("../../DB/model/provider.model.js");

// ── Step 3: Lifecycle ─────────────────────────────────────────────────────────

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "/api/v1/provider";

const validProviderPayload = (overrides = {}) => ({
  name: `Test Provider ${Date.now()}`,
  type: "hotel",
  phone: "+962791234567",
  address: "King Hussein Street, Amman",
  ...overrides,
});

/**
 * Creates a booking linking the given provider, making it undeletable.
 * Returns the booking response body.
 */
const createBookingLinkingProvider = async (
  providerId,
  adminHeader,
  serviceType = "main",
) => {
  const provider = providerId;

  const body = {
    provider: provider.toString(),
    customers: [{ name: "Linked Customer" }],
  };

  if (serviceType === "accommodation") {
    // Use a separate main provider and link the target as accommodation hotel
    const mainProvider = await createProvider({
      name: `Main ${Date.now()}`,
      type: "tourism",
    });
    body.provider = mainProvider._id.toString();
    body.accommodations = [buildAccommodation(providerId)];
  } else if (serviceType === "carRental") {
    const mainProvider = await createProvider({
      name: `Main ${Date.now()}`,
      type: "tourism",
    });
    body.provider = mainProvider._id.toString();
    body.carRentals = [buildCarRental(providerId)];
  } else if (serviceType === "trip") {
    const mainProvider = await createProvider({
      name: `Main ${Date.now()}`,
      type: "tourism",
    });
    body.provider = mainProvider._id.toString();
    body.tripsWithDrivers = [buildTrip(providerId)];
  }

  return request(app)
    .post("/api/v1/booking/create")
    .set("Authorization", adminHeader)
    .send(body);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /provider/create
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider — POST /create", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 201 with provider document and currentSequence: 0", async () => {
    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send(validProviderPayload({ name: "Grand Hyatt Amman" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toMatchObject({
      name: "Grand Hyatt Amman",
      type: "hotel",
    });
    expect(res.body.data.provider.currentSequence).toBe(0);
    expect(res.body.data.provider.totalBookings).toBe(0);
  });

  it("returns 400 when provider name already exists", async () => {
    await createProvider({ name: "Duplicate Hotel" });

    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send(validProviderPayload({ name: "Duplicate Hotel" }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when name is missing", async () => {
    const { name: _omit, ...payload } = validProviderPayload();
    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send({ type: "hotel" }); // no name

    expect(res.status).toBe(400);
  });

  it("returns 400 when type is missing", async () => {
    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send({ name: "No Type Provider" }); // no type

    expect(res.status).toBe(400);
  });

  it("returns 400 when type is not one of the allowed values", async () => {
    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send(validProviderPayload({ type: "airline" }));

    expect(res.status).toBe(400);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", staffHeader)
      .send(validProviderPayload());

    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app)
      .post(`${BASE}/create`)
      .send(validProviderPayload());

    expect(res.status).toBe(401);
  });

  it("persists the provider to the database", async () => {
    const res = await request(app)
      .post(`${BASE}/create`)
      .set("Authorization", adminHeader)
      .send(validProviderPayload({ name: "DB Persist Hotel" }));

    expect(res.status).toBe(201);
    const found = await providerModel.findById(res.body.data.provider._id);
    expect(found).not.toBeNull();
    expect(found.name).toBe("DB Persist Hotel");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /provider/getAll
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider — GET /getAll", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with paginated providers list", async () => {
    await createProvider({ name: "Hotel A" });
    await createProvider({ name: "Car Co B", type: "car_rental" });

    const res = await request(app)
      .get(`${BASE}/getAll`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.providers.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.totalCount).toBeGreaterThanOrEqual(2);
  });

  it("filters by type=hotel and returns only hotels", async () => {
    await createProvider({ name: "Hotel Only", type: "hotel" });
    await createProvider({ name: "Car Only", type: "car_rental" });

    const res = await request(app)
      .get(`${BASE}/getAll?type=hotel`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    res.body.data.providers.forEach((p) => {
      expect(p.type).toBe("hotel");
    });
  });

  it("returns empty providers array when no providers exist", async () => {
    const res = await request(app)
      .get(`${BASE}/getAll`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.providers).toHaveLength(0);
    expect(res.body.data.totalCount).toBe(0);
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app).get(`${BASE}/getAll`);
    expect(res.status).toBe(401);
  });

  it("booking_staff can view all providers (provider_view permission)", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .get(`${BASE}/getAll`)
      .set("Authorization", staffHeader);

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /provider/get/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider — GET /get/:id", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with the provider document", async () => {
    const provider = await createProvider({ name: "Lookup Hotel" });

    const res = await request(app)
      .get(`${BASE}/get/${provider._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.provider._id).toBe(provider._id.toString());
    expect(res.body.data.provider.name).toBe("Lookup Hotel");
  });

  it("returns 404 when provider does not exist", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`${BASE}/get/${fakeId}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PATCH /provider/update/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider — PATCH /update/:id", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with updated provider", async () => {
    const provider = await createProvider({
      name: "Old Name Hotel",
      phone: "+962790000001",
    });

    const res = await request(app)
      .patch(`${BASE}/update/${provider._id}`)
      .set("Authorization", adminHeader)
      .send({ name: "New Name Hotel", phone: "+962790000002" });

    expect(res.status).toBe(200);
    expect(res.body.data.provider.name).toBe("New Name Hotel");
    expect(res.body.data.provider.phone).toBe("+962790000002");
  });

  it("cannot overwrite currentSequence or totalBookings via update", async () => {
    const provider = await createProvider({ name: "Sequence Guard Hotel" });

    await request(app)
      .patch(`${BASE}/update/${provider._id}`)
      .set("Authorization", adminHeader)
      .send({ currentSequence: 9999, totalBookings: 9999, name: "Updated" });

    const updated = await providerModel.findById(provider._id);
    expect(updated.currentSequence).toBe(0); // unchanged
    expect(updated.totalBookings).toBe(0); // unchanged
  });

  it("returns 404 when provider does not exist", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`${BASE}/update/${fakeId}`)
      .set("Authorization", adminHeader)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();
    const provider = await createProvider({ name: "Staff Target" });

    const res = await request(app)
      .patch(`${BASE}/update/${provider._id}`)
      .set("Authorization", staffHeader)
      .send({ name: "Staff Updated" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DELETE /provider/delete/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider — DELETE /delete/:id", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 and removes provider from DB", async () => {
    const provider = await createProvider({ name: "Deletable Hotel" });

    const res = await request(app)
      .delete(`${BASE}/delete/${provider._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const found = await providerModel.findById(provider._id);
    expect(found).toBeNull();
  });

  it("returns 400 when provider is the main booking provider", async () => {
    const provider = await createProvider({ name: "Main Linked Hotel" });

    await createBookingLinkingProvider(provider._id, adminHeader, "main");

    const res = await request(app)
      .delete(`${BASE}/delete/${provider._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when provider is linked as accommodations.hotel", async () => {
    const hotel = await createProvider({ name: "Acc Hotel Linked" });

    await createBookingLinkingProvider(hotel._id, adminHeader, "accommodation");

    const res = await request(app)
      .delete(`${BASE}/delete/${hotel._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(400);
  });

  it("returns 400 when provider is linked as carRentals.provider", async () => {
    const carCo = await createProvider({
      name: "Car Co Linked",
      type: "car_rental",
    });

    await createBookingLinkingProvider(carCo._id, adminHeader, "carRental");

    const res = await request(app)
      .delete(`${BASE}/delete/${carCo._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(400);
  });

  it("returns 400 when provider is linked as tripsWithDrivers.provider", async () => {
    const driverCo = await createProvider({
      name: "Driver Co Linked",
      type: "driver_company",
    });

    await createBookingLinkingProvider(driverCo._id, adminHeader, "trip");

    const res = await request(app)
      .delete(`${BASE}/delete/${driverCo._id}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(400);
  });

  it("returns 404 when provider does not exist", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`${BASE}/delete/${fakeId}`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(404);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();
    const provider = await createProvider({ name: "Staff Delete Target" });

    const res = await request(app)
      .delete(`${BASE}/delete/${provider._id}`)
      .set("Authorization", staffHeader);

    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth header is provided", async () => {
    const provider = await createProvider({ name: "No Auth Delete" });

    const res = await request(app).delete(`${BASE}/delete/${provider._id}`);

    expect(res.status).toBe(401);
  });
});
