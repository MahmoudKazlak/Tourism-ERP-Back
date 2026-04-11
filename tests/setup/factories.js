/**
 * Test data factories.
 *
 * Every factory returns a plain object ready to pass to Model.create()
 * or to an HTTP request body. Factories accept partial overrides so
 * individual tests only spell out what they care about.
 *
 * Naming convention:
 *   build<Model>   → returns a plain object (no DB write)
 *   create<Model>  → writes to the DB and returns the document
 */
import jwt from "jsonwebtoken";
import userModel from "../../DB/model/user.model.js";
import providerModel from "../../DB/model/provider.model.js";

// ── Plain object builders ─────────────────────────────────────────────────────

export const buildProvider = (overrides = {}) => ({
  name: `Test Provider ${Date.now()}`,
  type: "hotel",
  phone: "+970591234567",
  address: "Test Street 1",
  currentSequence: 0,
  ...overrides,
});

export const buildUser = (overrides = {}) => ({
  userName: "TestAdmin",
  email: `admin_${Date.now()}@test.com`,
  password: "Admin@123",
  role: "admin",
  ...overrides,
});

export const buildCustomer = (overrides = {}) => ({
  name: "John Doe",
  ageType: "adult",
  ...overrides,
});

export const buildAccommodation = (hotelId, overrides = {}) => ({
  hotel: hotelId.toString(),
  checkIn: new Date("2025-06-01"),
  checkOut: new Date("2025-06-05"), // 4 nights
  roomType: "Double",
  board: "BB",
  buy: 400,
  sell: 600,
  ...overrides,
});

export const buildCarRental = (providerId, overrides = {}) => ({
  provider: providerId.toString(),
  brand: "Toyota Camry",
  pickUp: new Date("2025-06-01"),
  dropOff: new Date("2025-06-05"),
  buy: 200,
  sell: 320,
  ...overrides,
});

export const buildTrip = (providerId, overrides = {}) => ({
  provider: providerId.toString(),
  driverName: "Ahmad",
  brand: "Mercedes",
  buy: 100,
  sell: 150,
  ...overrides,
});

// ── DB-writing creators ───────────────────────────────────────────────────────

export const createProvider = async (overrides = {}) => {
  return providerModel.create(buildProvider(overrides));
};

export const createUser = async (overrides = {}) => {
  return userModel.create(buildUser(overrides));
};

// ── Auth token helpers ────────────────────────────────────────────────────────

/**
 * Signs a JWT access token for the given user document.
 * Uses the same secret and algorithm as the production auth middleware.
 *
 * @param {import('mongoose').Document} user
 * @returns {string} Authorization header value ("Bearer <token>")
 */
export const getAuthHeader = (user) => {
  const token = jwt.sign(
    { id: user._id },
    process.env.SIGNINTOKEN,
    { expiresIn: "1h" },
  );
  return `Bearer ${token}`;
};

/**
 * Creates an admin user in the DB and returns a ready-to-use auth header.
 * Convenience wrapper used in beforeEach blocks.
 *
 * @param {object} overrides
 * @returns {{ user, authHeader }}
 */
export const createAdminWithToken = async (overrides = {}) => {
  const user = await createUser({ role: "admin", ...overrides });
  return { user, authHeader: getAuthHeader(user) };
};

/**
 * Creates a booking_staff user and returns auth header.
 */
export const createBookingStaffWithToken = async (overrides = {}) => {
  const user = await createUser({ role: "booking_staff", ...overrides });
  return { user, authHeader: getAuthHeader(user) };
};
