import { describe, it, expect } from "@jest/globals";
import { generateInvoicePdfBuffer } from "../../src/services/invoicePdfService.js";

describe("invoicePdfService", () => {
  it("generates a valid PDF buffer from invoice payload", async () => {
    const invoice = {
      invoiceType: "FULL INVOICE",
      invoiceNumber: "INV-1001-1234",
      issueDate: new Date("2025-06-01"),
      booking: {
        bookingID: 1001,
        status: "confirmed",
        paymentStatus: "partial",
        createdAt: new Date("2025-05-28"),
        provider: "Grand Hotel",
      },
      billTo: {
        names: ["John Doe", "Jane Doe"],
        pax: { adults: 2, kids: 0, total: 2 },
      },
      issuedBy: "Admin User",
      lineItems: [
        {
          serviceNumber: 1,
          type: "Hotel Accommodation",
          description: "Double / BB / 4 nights",
          provider: "Grand Hotel",
          amount: 1200,
        },
      ],
      totals: {
        subtotal: 1200,
        totalToPay: 1200,
        totalPaid: 400,
        remainingBalance: 800,
        paymentStatus: "partial",
      },
      payments: [
        {
          date: new Date("2025-05-29"),
          amount: 400,
          method: "cash",
          paidTo: "Office",
        },
      ],
    };

    const buffer = await generateInvoicePdfBuffer(invoice);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");

    const pageCount = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    expect(pageCount).toBe(1);
  });

  it("renders a single page with many services and payments", async () => {
    const lineItems = Array.from({ length: 8 }, (_, i) => ({
      serviceNumber: i + 1,
      type: "Hotel Accommodation",
      description: `Room ${i + 1} / BB / 3 nights`,
      provider: "Grand Hotel",
      amount: 500 + i * 50,
    }));

    const payments = Array.from({ length: 5 }, (_, i) => ({
      date: new Date(`2025-05-${10 + i}`),
      amount: 200,
      method: "cash",
      paidTo: "Office",
    }));

    const buffer = await generateInvoicePdfBuffer({
      invoiceType: "FULL INVOICE",
      invoiceNumber: "INV-2000-5678",
      issueDate: new Date("2025-06-01"),
      booking: {
        bookingID: 2000,
        status: "confirmed",
        paymentStatus: "partial",
        createdAt: new Date("2025-05-28"),
        provider: "Grand Hotel",
      },
      billTo: {
        names: ["John Doe"],
        pax: { adults: 2, kids: 1, total: 3 },
      },
      issuedBy: "Admin User",
      lineItems,
      totals: {
        subtotal: 4600,
        totalToPay: 4600,
        totalPaid: 1000,
        remainingBalance: 3600,
        paymentStatus: "partial",
      },
      payments,
    });

    const pageCount = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    expect(pageCount).toBe(1);
  });
});
