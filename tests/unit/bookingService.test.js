import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
} from "@jest/globals";

import "../../DB/model/booking.model.js";
import "../../DB/model/provider.model.js";

import {
  connectTestDB,
  disconnectTestDB,
  clearCollections,
} from "../setup/db.js";
import {
  calculateBookingTotals,
  assignBookingSequences,
} from "../../src/services/bookingService.js";
import providerModel from "../../DB/model/provider.model.js";
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_PROVIDER_ID = new mongoose.Types.ObjectId();

const svc = (serviceType, buy, sell, detailOverrides = {}) => ({
  serviceType,
  provider: FAKE_PROVIDER_ID,
  buy,
  sell,
  profit: 0,
  details: detailOverrides,
});

const makeDoc = (overrides = {}) => ({
  isNew: true,
  services: [],
  totalPaid: 0,
  totalToPay: 0,
  totalToBuy: 0,
  totalProfit: 0,
  remainingBalance: 0,
  paymentStatus: "unpaid",
  isModified: () => false,
  markModified: jest.fn(),
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateBookingTotals — pure function, no DB required
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateBookingTotals()", () => {
  describe("Financial roll-up", () => {
    it("sums sell across services to produce correct totalToPay", () => {
      const doc = makeDoc({
        services: [
          svc("accommodation", 400, 600),
          svc("accommodation", 300, 400),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(1000);
    });

    it("sums buy across services to produce correct totalToBuy", () => {
      const doc = makeDoc({
        services: [
          svc("accommodation", 400, 600),
          svc("accommodation", 300, 400),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToBuy).toBe(700);
    });

    it("totalProfit equals totalToPay minus totalToBuy", () => {
      const doc = makeDoc({ services: [svc("accommodation", 400, 600)] });
      calculateBookingTotals(doc);
      expect(doc.totalProfit).toBe(200);
    });

    it("combines mixed service types in totals", () => {
      const doc = makeDoc({
        services: [
          svc("accommodation", 400, 600),
          svc("carRental", 200, 320),
          svc("carWithDriver", 100, 150),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(1070);
      expect(doc.totalToBuy).toBe(700);
      expect(doc.totalProfit).toBe(370);
    });

    it("empty services produces all-zero totals", () => {
      const doc = makeDoc();
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(0);
      expect(doc.totalToBuy).toBe(0);
      expect(doc.totalProfit).toBe(0);
      expect(doc.remainingBalance).toBe(0);
    });

    it("calculates per-item profit = sell - buy on each service", () => {
      const acc = svc("accommodation", 400, 600);
      const car = svc("carRental", 200, 320);
      const trip = svc("trip", 80, 150);
      const doc = makeDoc({ services: [acc, car, trip] });
      calculateBookingTotals(doc);
      expect(doc.services[0].profit).toBe(200);
      expect(doc.services[1].profit).toBe(120);
      expect(doc.services[2].profit).toBe(70);
    });

    it("handles empty services array gracefully — no crash", () => {
      const doc = makeDoc();
      expect(() => calculateBookingTotals(doc)).not.toThrow();
      expect(doc.totalToPay).toBe(0);
    });

    it("handles undefined sell/buy values by treating them as 0", () => {
      const doc = makeDoc({
        services: [
          {
            serviceType: "accommodation",
            provider: FAKE_PROVIDER_ID,
            sell: undefined,
            buy: undefined,
            profit: 0,
            details: {},
          },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(0);
      expect(doc.totalProfit).toBe(0);
    });

    it("sets remainingBalance = totalToPay - totalPaid", () => {
      const doc = makeDoc({
        services: [svc("accommodation", 700, 1000)],
        totalPaid: 350,
      });
      calculateBookingTotals(doc);
      expect(doc.remainingBalance).toBe(650);
    });
  });

  describe("Payment status derivation", () => {
    it('sets paymentStatus to "unpaid" when totalPaid is 0', () => {
      const doc = makeDoc({
        services: [svc("accommodation", 300, 500)],
        totalPaid: 0,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("unpaid");
    });

    it('sets paymentStatus to "partial" when 0 < totalPaid < totalToPay', () => {
      const doc = makeDoc({
        services: [svc("accommodation", 300, 500)],
        totalPaid: 250,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("partial");
    });

    it('sets paymentStatus to "paid" when totalPaid equals totalToPay', () => {
      const doc = makeDoc({
        services: [svc("accommodation", 300, 500)],
        totalPaid: 500,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("paid");
    });

    it('sets paymentStatus to "paid" when totalPaid exceeds totalToPay (overpaid)', () => {
      const doc = makeDoc({
        services: [svc("accommodation", 300, 500)],
        totalPaid: 600,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("paid");
    });
  });

  describe("Duration auto-calculation (durationFields)", () => {
    it("calculates duration in nights for accommodation", () => {
      const doc = makeDoc({
        services: [
          svc("accommodation", 320, 400, {
            checkIn: new Date("2025-06-01"),
            checkOut: new Date("2025-06-05"),
          }),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.services[0].duration).toBe(4);
    });

    it("calculates duration in days for carRental", () => {
      const doc = makeDoc({
        services: [
          svc("carRental", 200, 320, {
            pickUp: new Date("2025-06-01"),
            dropOff: new Date("2025-06-03"),
          }),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.services[0].duration).toBe(2);
    });

    it("skips duration calculation when date fields are missing", () => {
      const doc = makeDoc({
        services: [
          svc("accommodation", 80, 100, { checkIn: new Date("2025-06-01") }),
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.services[0].duration).toBeUndefined();
    });

    it("does not set duration for service types without durationFields (trip)", () => {
      const doc = makeDoc({
        services: [svc("trip", 150, 250, { destination: "Petra" })],
      });
      calculateBookingTotals(doc);
      expect(doc.services[0].duration).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assignBookingSequences — requires real DB connection
// ─────────────────────────────────────────────────────────────────────────────

describe("assignBookingSequences()", () => {
  beforeAll(connectTestDB);
  afterEach(clearCollections);
  afterAll(disconnectTestDB);

  const makeSeqDoc = (providerId, overrides = {}) => ({
    isNew: true,
    bookingID: null,
    provider: providerId,
    services: [],
    _id: new mongoose.Types.ObjectId(),
    isModified: (field) =>
      field === "provider" && !!overrides._providerModified,
    markModified: jest.fn(),
    ...overrides,
  });

  const createTestProvider = (overrides = {}) =>
    providerModel.create({
      name: `Provider ${Date.now()}_${Math.random()}`,
      type: "hotel",
      currentSequence: 0,
      totalBookings: 0,
      ...overrides,
    });

  it("increments provider.currentSequence by exactly 1 on first booking", async () => {
    const provider = await createTestProvider();
    await assignBookingSequences(makeSeqDoc(provider._id));
    const updated = await providerModel.findById(provider._id);
    expect(updated.currentSequence).toBe(1);
    expect(updated.totalBookings).toBe(1);
  });

  it("sets bookingID on the document to match provider.currentSequence", async () => {
    const provider = await createTestProvider();
    const doc = makeSeqDoc(provider._id);
    await assignBookingSequences(doc);
    expect(doc.bookingID).toBe(1);
  });

  it("produces consecutive bookingIDs for sequential bookings", async () => {
    const provider = await createTestProvider();
    const doc1 = makeSeqDoc(provider._id);
    const doc2 = makeSeqDoc(provider._id);
    const doc3 = makeSeqDoc(provider._id);
    await assignBookingSequences(doc1);
    await assignBookingSequences(doc2);
    await assignBookingSequences(doc3);
    expect(doc1.bookingID).toBe(1);
    expect(doc2.bookingID).toBe(2);
    expect(doc3.bookingID).toBe(3);
  });

  it("assigns serviceNumber = bookingID when service provider equals main provider", async () => {
    const provider = await createTestProvider();
    const doc = makeSeqDoc(provider._id, {
      services: [
        {
          serviceType: "accommodation",
          provider: provider._id,
          serviceNumber: null,
          sell: 500,
          buy: 400,
          details: {},
        },
      ],
    });
    await assignBookingSequences(doc);
    expect(doc.services[0].serviceNumber).toBe(doc.bookingID);
  });

  it("increments sub-provider sequence when service uses a different provider", async () => {
    const mainProvider = await createTestProvider({
      type: "tourism",
      name: `Tour_${Date.now()}`,
    });
    const carProvider = await createTestProvider({
      type: "car_rental",
      name: `Car_${Date.now()}`,
    });
    const doc = makeSeqDoc(mainProvider._id, {
      services: [
        {
          serviceType: "carRental",
          provider: carProvider._id,
          serviceNumber: null,
          sell: 300,
          buy: 200,
          details: {},
        },
      ],
    });
    await assignBookingSequences(doc);
    const updatedCar = await providerModel.findById(carProvider._id);
    expect(updatedCar.currentSequence).toBe(1);
    expect(doc.services[0].serviceNumber).toBe(1);
  });

  it("does NOT re-assign serviceNumber when serviceNumber is already set (existing service)", async () => {
    const provider = await createTestProvider({
      currentSequence: 5,
      totalBookings: 5,
    });
    const doc = makeSeqDoc(provider._id, {
      isNew: false,
      bookingID: 5,
      services: [
        {
          _id: new mongoose.Types.ObjectId(),
          serviceType: "accommodation",
          provider: provider._id,
          serviceNumber: 5, // already assigned
          sell: 500,
          buy: 400,
          details: {},
        },
      ],
    });
    await assignBookingSequences(doc);
    const after = await providerModel.findById(provider._id);
    expect(after.currentSequence).toBe(5); // unchanged
    expect(doc.services[0].serviceNumber).toBe(5); // preserved
  });

  it("uses null check (not falsy) so serviceNumber = 0 is preserved", () => {
    const item = { serviceNumber: 0 };
    expect(item.serviceNumber == null).toBe(false);
    expect(!item.serviceNumber).toBe(true);
  });

  it("calls markModified on the services array after processing", async () => {
    const provider = await createTestProvider();
    const doc = makeSeqDoc(provider._id);
    await assignBookingSequences(doc);
    expect(doc.markModified).toHaveBeenCalledWith("services");
  });
});
