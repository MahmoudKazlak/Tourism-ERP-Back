/**
 * Integration tests — Expense module
 * Covers create expense, get all expenses with filters and aggregation.
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
const { createAdminWithToken, createBookingStaffWithToken } =
  await import("../setup/factories.js");
const { default: expenseModel } =
  await import("../../DB/model/expense.model.js");

// ── Step 3: Lifecycle ─────────────────────────────────────────────────────────

beforeAll(connectTestDB);
afterEach(clearCollections);
afterAll(disconnectTestDB);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "/api/v1/expense";

const validExpensePayload = (overrides = {}) => ({
  category: "rent",
  amount: 500,
  description: "Monthly office rent payment",
  method: "bank_transfer",
  ...overrides,
});

/**
 * Posts a single expense with admin credentials and returns the response.
 */
const createExpenseViaApi = async (adminHeader, overrides = {}) =>
  request(app)
    .post(BASE)
    .set("Authorization", adminHeader)
    .send(validExpensePayload(overrides));

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /expense  (accounting_only — admin + accounting_staff)
// ─────────────────────────────────────────────────────────────────────────────

describe("Expense — POST /expense", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 201 with expense document on success", async () => {
    const res = await createExpenseViaApi(adminHeader);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expense).toMatchObject({
      category: "rent",
      amount: 500,
      method: "bank_transfer",
    });
    expect(res.body.errors).toBeNull();
  });

  it("date defaults to now when omitted", async () => {
    const before = new Date();

    const res = await createExpenseViaApi(adminHeader, { date: undefined });

    const after = new Date();
    expect(res.status).toBe(201);

    const expense = await expenseModel.findById(res.body.data.expense._id);
    expect(expense.date.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
    expect(expense.date.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("persists the expense with correct recordedBy (the authenticated user)", async () => {
    const { user, authHeader } = await createAdminWithToken();

    const res = await createExpenseViaApi(authHeader);

    const expense = await expenseModel.findById(res.body.data.expense._id);
    expect(expense.recordedBy.toString()).toBe(user._id.toString());
  });

  it("returns 400 when amount is missing", async () => {
    const { amount: _omit, ...payload } = validExpensePayload();
    const res = await request(app)
      .post(BASE)
      .set("Authorization", adminHeader)
      .send(payload);

    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is zero", async () => {
    const res = await createExpenseViaApi(adminHeader, { amount: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is negative", async () => {
    const res = await createExpenseViaApi(adminHeader, { amount: -100 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when category is missing", async () => {
    const { category: _omit, ...payload } = validExpensePayload();
    const res = await request(app)
      .post(BASE)
      .set("Authorization", adminHeader)
      .send(payload);

    expect(res.status).toBe(400);
  });

  it("returns 400 when category is an invalid value", async () => {
    const res = await createExpenseViaApi(adminHeader, {
      category: "vacation",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is missing", async () => {
    const { description: _omit, ...payload } = validExpensePayload();
    const res = await request(app)
      .post(BASE)
      .set("Authorization", adminHeader)
      .send(payload);

    expect(res.status).toBe(400);
  });

  it("returns 400 when description is shorter than 3 characters", async () => {
    const res = await createExpenseViaApi(adminHeader, { description: "Hi" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .post(BASE)
      .set("Authorization", staffHeader)
      .send(validExpensePayload());

    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app).post(BASE).send(validExpensePayload());

    expect(res.status).toBe(401);
  });

  it("accepts all valid category values", async () => {
    const categories = [
      "rent",
      "utilities",
      "salary",
      "supplies",
      "maintenance",
      "other",
    ];

    for (const category of categories) {
      const res = await createExpenseViaApi(adminHeader, {
        category,
        description: `${category} expense description`,
      });
      expect(res.status).toBe(201);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /expense  (accounting_only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Expense — GET /expense", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with paginated expenses, grandTotal and byCategory breakdown", async () => {
    await createExpenseViaApi(adminHeader, { category: "rent", amount: 500 });
    await createExpenseViaApi(adminHeader, {
      category: "salary",
      amount: 1200,
    });
    await createExpenseViaApi(adminHeader, {
      category: "utilities",
      amount: 300,
    });

    const res = await request(app).get(BASE).set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCount).toBe(3);
    expect(res.body.data.grandTotal).toBe(2000);
    expect(res.body.data.byCategory).toBeDefined();
    expect(res.body.data.byCategory.rent).toMatchObject({
      total: 500,
      count: 1,
    });
    expect(res.body.data.byCategory.salary).toMatchObject({
      total: 1200,
      count: 1,
    });
    expect(res.body.data.byCategory.utilities).toMatchObject({
      total: 300,
      count: 1,
    });
    expect(Array.isArray(res.body.data.expenses)).toBe(true);
  });

  it("returns empty expenses when no expenses exist", async () => {
    const res = await request(app).get(BASE).set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.totalCount).toBe(0);
    expect(res.body.data.grandTotal).toBe(0);
    expect(res.body.data.expenses).toHaveLength(0);
  });

  it("filters by category=salary returns only salary expenses", async () => {
    await createExpenseViaApi(adminHeader, { category: "rent", amount: 500 });
    await createExpenseViaApi(adminHeader, {
      category: "salary",
      amount: 1200,
      description: "Staff salary for June",
    });

    const res = await request(app)
      .get(`${BASE}?category=salary`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.expenses).toHaveLength(1);
    expect(res.body.data.expenses[0].category).toBe("salary");
    expect(res.body.data.grandTotal).toBe(1200);
  });

  it("filters by fromDate/toDate returns only expenses within the range", async () => {
    // Create expense with an explicit past date
    await request(app)
      .post(BASE)
      .set("Authorization", adminHeader)
      .send({
        ...validExpensePayload({ amount: 999 }),
        date: "2020-01-15",
      });

    // Create expense with today's date (default)
    await createExpenseViaApi(adminHeader, { amount: 123 });

    const res = await request(app)
      .get(`${BASE}?fromDate=2020-01-01&toDate=2020-12-31`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    // Only the 2020 expense should appear
    expect(res.body.data.expenses).toHaveLength(1);
    expect(res.body.data.expenses[0].amount).toBe(999);
  });

  it("aggregates correctly when multiple expenses share the same category", async () => {
    await createExpenseViaApi(adminHeader, {
      category: "supplies",
      amount: 100,
    });
    await createExpenseViaApi(adminHeader, {
      category: "supplies",
      amount: 200,
    });
    await createExpenseViaApi(adminHeader, {
      category: "supplies",
      amount: 50,
    });

    const res = await request(app)
      .get(`${BASE}?category=supplies`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.grandTotal).toBe(350);
    expect(res.body.data.byCategory.supplies).toMatchObject({
      total: 350,
      count: 3,
    });
  });

  it("respects page and size pagination params", async () => {
    // Create 5 expenses
    for (let i = 1; i <= 5; i++) {
      await createExpenseViaApi(adminHeader, { amount: i * 100 });
    }

    const res = await request(app)
      .get(`${BASE}?page=1&size=2`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.expenses).toHaveLength(2);
    expect(res.body.data.totalCount).toBe(5);
    expect(res.body.data.totalPages).toBe(3);
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app).get(BASE).set("Authorization", staffHeader);

    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it("accounting_staff can access expenses (accounting_only permission)", async () => {
    const { authHeader: accHeader } = await createAdminWithToken({
      role: "accounting_staff",
    });
    await createExpenseViaApi(adminHeader, { amount: 200 });

    const res = await request(app).get(BASE).set("Authorization", accHeader);

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /expense/cash-closing  (daily cash closing report)
// ─────────────────────────────────────────────────────────────────────────────

describe("Expense — GET /expense/cash-closing", () => {
  let adminHeader;

  beforeEach(async () => {
    ({ authHeader: adminHeader } = await createAdminWithToken());
  });

  it("returns 200 with cash closing structure (date, cash, allIncome, allExpenses, netForDay)", async () => {
    const res = await request(app)
      .get(`${BASE}/cash-closing`)
      .set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      cash: {
        in: expect.any(Number),
        out: expect.any(Number),
        inDrawer: expect.any(Number),
      },
      allIncome: { total: expect.any(Number) },
      allExpenses: { total: expect.any(Number) },
      netForDay: expect.any(Number),
    });
  });

  it("returns 403 when called by booking_staff", async () => {
    const { authHeader: staffHeader } = await createBookingStaffWithToken();

    const res = await request(app)
      .get(`${BASE}/cash-closing`)
      .set("Authorization", staffHeader);

    expect(res.status).toBe(403);
  });
});
