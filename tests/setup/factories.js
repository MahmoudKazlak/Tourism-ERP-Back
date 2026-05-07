import jwt from "jsonwebtoken";
import userModel from "../../DB/model/user.model.js";
import providerModel from "../../DB/model/provider.model.js";

let _seq = 0;
const uid = () => `${Date.now()}_${++_seq}`;

// ── Plain object builders ─────────────────────────────────────────────────────

export const buildProvider = (overrides = {}) => ({
  name: `Test Provider ${uid()}`,
  type: "hotel",
  phone: "+970591234567",
  address: "Test Street 1",
  currentSequence: 0,
  ...overrides,
});

export const buildUser = (overrides = {}) => ({
  userName: "TestAdmin",
  email: `user_${uid()}@test.com`,
  password: "Admin@123",
  role: "admin",
  ...overrides,
});

export const buildCustomer = (overrides = {}) => ({
  name: "John Doe",
  ageType: "adult",
  ...overrides,
});

/**
 * Generic service builder.
 * Returns an object matching the unified booking.services array schema.
 */
export const buildService = (serviceType, providerId, overrides = {}) => {
  const defaults = {
    accommodation: {
      buy: 400,
      sell: 600,
      details: {
        checkIn: new Date("2025-06-01"),
        checkOut: new Date("2025-06-05"),
        roomType: "Double",
        board: "BB",
      },
    },
    carRental: {
      buy: 200,
      sell: 320,
      details: {
        brand: "Toyota Camry",
        pickUp: new Date("2025-06-01"),
        dropOff: new Date("2025-06-05"),
      },
    },
    carWithDriver: {
      buy: 100,
      sell: 150,
      details: { driverName: "Ahmad", brand: "Mercedes" },
    },
    apartRent: {
      buy: 350,
      sell: 500,
      details: {
        checkIn: new Date("2025-06-01"),
        checkOut: new Date("2025-06-05"),
        address: "Test Apartment, Floor 3",
      },
    },
    trip: {
      buy: 150,
      sell: 250,
      details: { destination: "Petra", date: new Date("2025-06-03") },
    },
  };

  const d = defaults[serviceType] || { buy: 100, sell: 200, details: {} };

  return {
    serviceType,
    provider: providerId.toString(),
    buy: overrides.buy ?? d.buy,
    sell: overrides.sell ?? d.sell,
    details: { ...d.details, ...(overrides.details || {}) },
  };
};

// ── Shorthand builders (backward-compatible API surface) ──────────────────────

export const buildAccommodation = (hotelId, overrides = {}) =>
  buildService("accommodation", hotelId, overrides);

export const buildCarRental = (providerId, overrides = {}) =>
  buildService("carRental", providerId, overrides);

export const buildCarWithDriver = (providerId, overrides = {}) =>
  buildService("carWithDriver", providerId, overrides);

// ── DB-writing creators ───────────────────────────────────────────────────────

export const createProvider = async (overrides = {}) =>
  providerModel.create(buildProvider(overrides));

export const createUser = async (overrides = {}) =>
  userModel.create(buildUser(overrides));

// ── Auth token helpers ────────────────────────────────────────────────────────

export const getAuthHeader = (user) => {
  const token = jwt.sign({ id: user._id }, process.env.SIGNINTOKEN, {
    expiresIn: "1h",
  });
  return `Bearer ${token}`;
};

export const createAdminWithToken = async (overrides = {}) => {
  const user = await createUser({ role: "admin", ...overrides });
  return { user, authHeader: getAuthHeader(user) };
};

export const createBookingStaffWithToken = async (overrides = {}) => {
  const user = await createUser({ role: "booking_staff", ...overrides });
  return { user, authHeader: getAuthHeader(user) };
};
