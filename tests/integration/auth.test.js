/**
 * Integration tests — Auth module
 * Covers signin, refresh, logout, createUser, getAllUsers, updateUser.
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
  createUser,
  getAuthHeader,
  createBookingStaffWithToken,
} = await import("../setup/factories.js");
const { default: userModel } = await import("../../DB/model/user.model.js");
const { default: refreshTokenModel } =
  await import("../../DB/model/refreshToken.model.js");

// ── Step 3: Lifecycle ─────────────────────────────────────────────────────────

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "/api/v1/auth";

/** Creates a real user in DB and signs in, returning the full sign-in response body. */
const signIn = (email, password) =>
  request(app).post(`${BASE}/signin`).send({ email, password });

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /auth/signin
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — POST /signin", () => {
  it("returns 200 with accessToken, refreshToken and safe user object", async () => {
    await createUser({
      email: "login@test.com",
      password: "Admin@123",
      role: "admin",
    });

    const res = await signIn("login@test.com", "Admin@123");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user).toMatchObject({
      email: "login@test.com",
      role: "admin",
    });
    // password must never appear in the response
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(res.body.data.user.id).toBeDefined();
    expect(res.body.data.user.userName).toBeDefined();
  });

  it("returns 400 with wrong password", async () => {
    await createUser({ email: "wrong@test.com", password: "Admin@123" });

    const res = await signIn("wrong@test.com", "WrongPass@1");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when email does not exist", async () => {
    const res = await signIn("nobody@test.com", "Admin@123");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 403 when user is blocked", async () => {
    await createUser({
      email: "blocked@test.com",
      password: "Admin@123",
      blocked: true,
    });

    const res = await signIn("blocked@test.com", "Admin@123");

    expect(res.status).toBe(403);
  });

  it("returns 400 when email field is missing", async () => {
    const res = await request(app)
      .post(`${BASE}/signin`)
      .send({ password: "Admin@123" });

    // Express body-parser passes through; the controller returns 400 on missing user
    expect(res.status).toBe(400);
  });

  it("returns 400 when password field is missing", async () => {
    const res = await request(app)
      .post(`${BASE}/signin`)
      .send({ email: "someone@test.com" });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /auth/refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — POST /refresh", () => {
  it("returns 200 with a new accessToken given a valid refresh token", async () => {
    await createUser({ email: "refresh@test.com", password: "Admin@123" });
    const signInRes = await signIn("refresh@test.com", "Admin@123");
    const { refreshToken } = signInRes.body.data;

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it("returns 400 when refreshToken field is absent", async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 when refresh token is invalid/tampered", async () => {
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken: "completely.invalid.token.string" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — POST /logout", () => {
  it("returns 200 and invalidates the refresh token", async () => {
    const user = await createUser({
      email: "logout@test.com",
      password: "Admin@123",
      role: "admin",
    });
    const signInRes = await signIn("logout@test.com", "Admin@123");
    const { refreshToken, accessToken } = signInRes.body.data;

    const res = await request(app)
      .post(`${BASE}/logout`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the token record is gone from DB
    const { default: crypto } = await import("crypto");
    const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const stored = await refreshTokenModel.findOne({ tokenHash: hash });
    expect(stored).toBeNull();
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post(`${BASE}/logout`)
      .send({ refreshToken: "anything" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /auth/createUser  (admin only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — POST /createUser", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  const validPayload = () => ({
    userName: "NewStaff",
    email: `staff_${Date.now()}@test.com`,
    password: "Pass@1234",
    cPassword: "Pass@1234",
    role: "booking_staff",
  });

  it("returns 201 with user_id when called by admin", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBeDefined();
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", staffHeader)
      .send(validPayload());

    expect(res.status).toBe(403);
  });

  it("returns 401 when called with no token", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .send(validPayload());

    expect(res.status).toBe(401);
  });

  it("returns 409 when email is already taken", async () => {
    const payload = validPayload();
    // Create user with same email first
    await createUser({
      email: payload.email,
      password: "Admin@123",
    });

    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when userName is shorter than 3 chars", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send({ ...validPayload(), userName: "AB" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when role is an invalid value", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send({ ...validPayload(), role: "superuser" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when cPassword does not match password", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send({ ...validPayload(), cPassword: "Different@99" });

    expect(res.status).toBe(400);
  });

  it("does not expose password in any response field", async () => {
    const res = await request(app)
      .post(`${BASE}/createUser`)
      .set("Authorization", adminHeader)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /auth/  (admin only — list all users)
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — GET /", () => {
  it("returns 200 with array of users and no passwords when called by admin", async () => {
    const { authHeader } = await createAdminWithToken();
    // Create a couple of extra users to verify list content
    await createUser({ email: "u1@test.com", password: "Admin@123" });
    await createUser({ email: "u2@test.com", password: "Admin@123" });

    const res = await request(app)
      .get(`${BASE}/`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    // None of the returned users should carry a password
    res.body.data.users.forEach((u) => {
      expect(u).not.toHaveProperty("password");
    });
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .get(`${BASE}/`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app).get(`${BASE}/`);
    expect(res.status).toBe(401);
  });

  it("filters users by role when role query param is provided", async () => {
    const { authHeader } = await createAdminWithToken();
    await createUser({
      email: "acc@test.com",
      password: "Admin@123",
      role: "accounting_staff",
    });

    const res = await request(app)
      .get(`${BASE}/?role=accounting_staff`)
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    res.body.data.users.forEach((u) => {
      expect(u.role).toBe("accounting_staff");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. PATCH /auth/update/:id  (admin only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — PATCH /update/:id", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with updated user data", async () => {
    const target = await createUser({
      email: "update_me@test.com",
      password: "Admin@123",
      userName: "OldName",
    });

    const res = await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", adminHeader)
      .send({ userName: "NewName" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.userName).toBe("NewName");
    // Password must not appear in response
    expect(res.body.data.user).not.toHaveProperty("password");
  });

  it("returns 404 when user ID does not exist", async () => {
    const { default: mongoose } = await import("mongoose");
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`${BASE}/update/${fakeId}`)
      .set("Authorization", adminHeader)
      .send({ userName: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when role value is invalid", async () => {
    const target = await createUser({
      email: "badrole@test.com",
      password: "Admin@123",
    });

    const res = await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", adminHeader)
      .send({ role: "god_mode" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when the request body is empty", async () => {
    const target = await createUser({
      email: "empty_update@test.com",
      password: "Admin@123",
    });

    const res = await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", adminHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it("blocks a user and prevents future sign-in", async () => {
    const target = await createUser({
      email: "tobeblocke@test.com",
      password: "Admin@123",
    });

    await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", adminHeader)
      .send({ blocked: true });

    const loginRes = await signIn("tobeblocke@test.com", "Admin@123");
    expect(loginRes.status).toBe(403);
  });

  it("does not allow updateUser to overwrite passwordResetToken via request body", async () => {
    const target = await createUser({
      email: "safe_update@test.com",
      password: "Admin@123",
    });

    // Attempt to inject a reset token through the update endpoint
    await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", adminHeader)
      .send({ userName: "SafeUpdate", passwordResetToken: "injected_token" });

    const updated = await userModel.findById(target._id);
    // Protected field must remain null, not the injected value
    expect(updated.passwordResetToken).toBeNull();
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();
    const target = await createUser({
      email: "staff_upd@test.com",
      password: "Admin@123",
    });

    const res = await request(app)
      .patch(`${BASE}/update/${target._id}`)
      .set("Authorization", staffHeader)
      .send({ userName: "Attempt" });

    expect(res.status).toBe(403);
  });
});
