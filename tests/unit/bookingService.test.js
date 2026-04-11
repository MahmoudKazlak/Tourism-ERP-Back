/**
 * Unit tests — bookingService.js
 * Tests calculateBookingTotals() as a pure function (no DB, no Supertest).
 * Tests assignBookingSequences() against the real in-memory MongoDB.
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

// Register Mongoose schemas so mongoose.model("Booking") / mongoose.model("Provider")
// resolve without throwing MissingSchemaError when called inside bookingService.
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
// Helper — minimal document mock
// ─────────────────────────────────────────────────────────────────────────────

const makeDoc = (overrides = {}) => ({
  isNew: true,
  accommodations: [],
  carRentals: [],
  tripsWithDrivers: [],
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
    it("sums sell across accommodations to produce correct totalToPay", () => {
      const doc = makeDoc({
        accommodations: [
          { sell: 600, buy: 400, profit: 0 },
          { sell: 400, buy: 300, profit: 0 },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(1000);
    });

    it("sums buy across accommodations to produce correct totalToBuy", () => {
      const doc = makeDoc({
        accommodations: [
          { sell: 600, buy: 400, profit: 0 },
          { sell: 400, buy: 300, profit: 0 },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToBuy).toBe(700);
    });

    it("totalProfit equals totalToPay minus totalToBuy", () => {
      const doc = makeDoc({
        accommodations: [{ sell: 600, buy: 400, profit: 0 }],
      });
      calculateBookingTotals(doc);
      expect(doc.totalProfit).toBe(200);
    });

    it("combines accommodations + carRentals + tripsWithDrivers totals", () => {
      const doc = makeDoc({
        accommodations: [{ sell: 600, buy: 400, profit: 0 }],
        carRentals: [{ sell: 320, buy: 200, profit: 0 }],
        tripsWithDrivers: [{ sell: 150, buy: 100, profit: 0 }],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(1070);
      expect(doc.totalToBuy).toBe(700);
      expect(doc.totalProfit).toBe(370);
    });

    it("empty doc with no services produces all-zero totals", () => {
      const doc = makeDoc();
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(0);
      expect(doc.totalToBuy).toBe(0);
      expect(doc.totalProfit).toBe(0);
      expect(doc.remainingBalance).toBe(0);
    });

    it("single accommodation — totals match that item's buy/sell exactly", () => {
      const doc = makeDoc({
        accommodations: [{ sell: 750, buy: 500, profit: 0 }],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(750);
      expect(doc.totalToBuy).toBe(500);
      expect(doc.totalProfit).toBe(250);
    });

    it("calculates per-item profit = sell - buy on each service", () => {
      const acc = { sell: 600, buy: 400, profit: 0 };
      const car = { sell: 320, buy: 200, profit: 0 };
      const trip = { sell: 150, buy: 80, profit: 0 };
      const doc = makeDoc({
        accommodations: [acc],
        carRentals: [car],
        tripsWithDrivers: [trip],
      });
      calculateBookingTotals(doc);
      expect(doc.accommodations[0].profit).toBe(200);
      expect(doc.carRentals[0].profit).toBe(120);
      expect(doc.tripsWithDrivers[0].profit).toBe(70);
    });

    it("handles missing service arrays gracefully — no crash when carRentals is undefined", () => {
      const doc = makeDoc();
      delete doc.carRentals;
      delete doc.tripsWithDrivers;
      expect(() => calculateBookingTotals(doc)).not.toThrow();
      expect(doc.totalToPay).toBe(0);
    });

    it("handles undefined sell/buy values by treating them as 0", () => {
      const doc = makeDoc({
        accommodations: [{ sell: undefined, buy: undefined, profit: 0 }],
      });
      calculateBookingTotals(doc);
      expect(doc.totalToPay).toBe(0);
      expect(doc.totalProfit).toBe(0);
    });

    it("sets remainingBalance = totalToPay - totalPaid", () => {
      const doc = makeDoc({
        accommodations: [{ sell: 1000, buy: 700, profit: 0 }],
        totalPaid: 350,
      });
      calculateBookingTotals(doc);
      expect(doc.remainingBalance).toBe(650);
    });
  });

  describe("Payment status derivation", () => {
    it('sets paymentStatus to "unpaid" when totalPaid is 0', () => {
      const doc = makeDoc({
        accommodations: [{ sell: 500, buy: 300, profit: 0 }],
        totalPaid: 0,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("unpaid");
    });

    it('sets paymentStatus to "partial" when 0 < totalPaid < totalToPay', () => {
      const doc = makeDoc({
        accommodations: [{ sell: 500, buy: 300, profit: 0 }],
        totalPaid: 250,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("partial");
    });

    it('sets paymentStatus to "paid" when totalPaid equals totalToPay', () => {
      const doc = makeDoc({
        accommodations: [{ sell: 500, buy: 300, profit: 0 }],
        totalPaid: 500,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("paid");
    });

    it('sets paymentStatus to "paid" when totalPaid exceeds totalToPay (overpaid)', () => {
      const doc = makeDoc({
        accommodations: [{ sell: 500, buy: 300, profit: 0 }],
        totalPaid: 600,
      });
      calculateBookingTotals(doc);
      expect(doc.paymentStatus).toBe("paid");
    });
  });

  describe("Hotel duration auto-calculation", () => {
    it("calculates duration in nights from checkIn to checkOut", () => {
      const doc = makeDoc({
        accommodations: [
          {
            checkIn: new Date("2025-06-01"),
            checkOut: new Date("2025-06-05"),
            sell: 400,
            buy: 320,
            profit: 0,
          },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.accommodations[0].duration).toBe(4);
    });

    it("calculates duration correctly for a 1-night stay", () => {
      const doc = makeDoc({
        accommodations: [
          {
            checkIn: new Date("2025-06-01"),
            checkOut: new Date("2025-06-02"),
            sell: 100,
            buy: 80,
            profit: 0,
          },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.accommodations[0].duration).toBe(1);
    });

    it("skips duration calculation when checkIn or checkOut is missing", () => {
      const doc = makeDoc({
        accommodations: [
          { checkIn: new Date("2025-06-01"), sell: 100, buy: 80, profit: 0 },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.accommodations[0].duration).toBeUndefined();
    });

    it("sets totalToPay correctly for a multi-night stay", () => {
      const doc = makeDoc({
        accommodations: [
          {
            checkIn: new Date("2025-06-01"),
            checkOut: new Date("2025-06-08"), // 7 nights
            sell: 700,
            buy: 490,
            profit: 0,
          },
        ],
      });
      calculateBookingTotals(doc);
      expect(doc.accommodations[0].duration).toBe(7);
      expect(doc.totalToPay).toBe(700);
      expect(doc.totalProfit).toBe(210);
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
    accommodations: [],
    carRentals: [],
    tripsWithDrivers: [],
    _id: new mongoose.Types.ObjectId(),
    isModified: (field) =>
      field === "provider" && !!overrides._providerModified,
    markModified: jest.fn(),
    ...overrides,
  });

  const createTestProvider = (overrides = {}) =>
    providerModel.create({
      name: `Provider ${Date.now()}`,
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
      accommodations: [
        { hotel: provider._id, serviceNumber: null, sell: 500, buy: 400 },
      ],
    });
    await assignBookingSequences(doc);
    expect(doc.accommodations[0].serviceNumber).toBe(doc.bookingID);
  });

  it("increments sub-provider sequence when service uses a different provider", async () => {
    const mainProvider = await createTestProvider({
      type: "tourism",
      name: "Tour Op",
    });
    const carProvider = await createTestProvider({
      type: "car_rental",
      name: "Car Co",
    });
    const doc = makeSeqDoc(mainProvider._id, {
      carRentals: [
        { provider: carProvider._id, serviceNumber: null, sell: 300, buy: 200 },
      ],
    });
    await assignBookingSequences(doc);
    const updatedCar = await providerModel.findById(carProvider._id);
    expect(updatedCar.currentSequence).toBe(1);
    expect(doc.carRentals[0].serviceNumber).toBe(1);
  });

  it("does NOT re-assign serviceNumber when serviceNumber is already set (existing service)", async () => {
    const provider = await createTestProvider({
      currentSequence: 5,
      totalBookings: 5,
    });
    const doc = makeSeqDoc(provider._id, {
      isNew: false,
      bookingID: 5,
      accommodations: [
        {
          _id: new mongoose.Types.ObjectId(),
          hotel: provider._id,
          serviceNumber: 5,
          sell: 500,
          buy: 400,
        },
      ],
    });
    await assignBookingSequences(doc);
    const after = await providerModel.findById(provider._id);
    expect(after.currentSequence).toBe(5);
    expect(doc.accommodations[0].serviceNumber).toBe(5);
  });

  it("uses null check (not falsy) so serviceNumber = 0 is preserved — FIX [1]", () => {
    const item = { serviceNumber: 0 };
    // The fix: item.serviceNumber == null → false → correctly skips re-assignment
    // The old bug: !item.serviceNumber → true → wrongly re-assigned 0
    expect(item.serviceNumber == null).toBe(false);
    expect(!item.serviceNumber).toBe(true);
  });

  it("calls markModified on all three service arrays after processing", async () => {
    const provider = await createTestProvider();
    const doc = makeSeqDoc(provider._id);
    await assignBookingSequences(doc);
    expect(doc.markModified).toHaveBeenCalledWith("accommodations");
    expect(doc.markModified).toHaveBeenCalledWith("carRentals");
    expect(doc.markModified).toHaveBeenCalledWith("tripsWithDrivers");
  });
});
