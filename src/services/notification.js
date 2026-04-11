import sendEmail from "./email.js";

// Email sending is best-effort — a failed notification should never
// crash a booking or payment transaction. All functions catch and log errors.

const STATUS_LABELS = {
  pending: "⏳ Pending",
  confirmed: "✅ Confirmed",
  cancelled: "❌ Cancelled",
  completed: "✔️ Completed",
};

const baseStyle = `
  font-family: Arial, sans-serif; color: #333;
  max-width: 600px; margin: auto; padding: 20px;
`;

const tableStyle = `
  border-collapse: collapse; width: 100%; margin-top: 12px;
`;

const cellStyle = `padding: 10px 14px; border: 1px solid #ddd;`;

/**
 * Notifies the booking creator when a booking's status changes.
 *
 * @param {Object} booking - Booking document with createdBy populated ({ _id, userName, email }).
 * @param {string} oldStatus
 * @param {string} newStatus
 */
export const notifyBookingStatusChanged = async (
  booking,
  oldStatus,
  newStatus,
) => {
  try {
    const creator = booking.createdBy;
    if (!creator?.email) return;

    const customerName = booking.customers?.[0]?.name || "Unknown Customer";

    await sendEmail(
      creator.email,
      `Booking #${booking.bookingID} — Status Changed to ${STATUS_LABELS[newStatus] || newStatus}`,
      `
      <div style="${baseStyle}">
        <h2 style="color:#2c3e50;">Booking Status Update</h2>
        <p>
          Booking <strong>#${booking.bookingID}</strong> for
          <strong>${customerName}</strong> has been updated.
        </p>
        <table style="${tableStyle}">
          <tr>
            <td style="${cellStyle}"><strong>Previous Status</strong></td>
            <td style="${cellStyle}">${STATUS_LABELS[oldStatus] || oldStatus}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>New Status</strong></td>
            <td style="${cellStyle}">${STATUS_LABELS[newStatus] || newStatus}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Booking ID</strong></td>
            <td style="${cellStyle}">#${booking.bookingID}</td>
          </tr>
        </table>
        <p style="margin-top:16px;color:#888;font-size:12px;">
          This is an automated notification from the booking system.
        </p>
      </div>
      `,
    );
  } catch (err) {
    // Never propagate notification failures to the caller.
    console.error(
      "❌ Failed to send booking status notification:",
      err.message,
    );
  }
};

/**
 * Notifies the booking creator when a payment is recorded on their booking.
 *
 * @param {Object} booking - Booking document with createdBy populated.
 * @param {Object} payment - Newly created payment object.
 * @param {string} recordedByName - Username of the person who recorded the payment.
 * @param {Object} summary - { totalPaid, remainingBalance, paymentStatus }
 */
export const notifyPaymentRecorded = async (
  booking,
  payment,
  recordedByName,
  summary,
) => {
  try {
    const creator = booking.createdBy;
    if (!creator?.email) return;

    const customerName = booking.customers?.[0]?.name || "Unknown Customer";
    const methodLabels = {
      cash: "Cash (نقداً)",
      bank_transfer: "Bank Transfer (حوالة)",
      check: "Check (شيك)",
      other: "Other",
    };

    await sendEmail(
      creator.email,
      `Payment Recorded — Booking #${booking.bookingID}`,
      `
      <div style="${baseStyle}">
        <h2 style="color:#2c3e50;">Payment Recorded</h2>
        <p>
          A payment has been recorded for booking
          <strong>#${booking.bookingID}</strong> (${customerName}).
        </p>
        <table style="${tableStyle}">
          <tr>
            <td style="${cellStyle}"><strong>Amount</strong></td>
            <td style="${cellStyle}">${payment.amount}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Method</strong></td>
            <td style="${cellStyle}">${methodLabels[payment.method] || payment.method}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Total Paid</strong></td>
            <td style="${cellStyle}">${summary.totalPaid}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Remaining Balance</strong></td>
            <td style="${cellStyle}">${summary.remainingBalance}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Payment Status</strong></td>
            <td style="${cellStyle}">${summary.paymentStatus}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Recorded By</strong></td>
            <td style="${cellStyle}">${recordedByName}</td>
          </tr>
        </table>
        <p style="margin-top:16px;color:#888;font-size:12px;">
          This is an automated notification from the booking system.
        </p>
      </div>
      `,
    );
  } catch (err) {
    console.error("❌ Failed to send payment notification:", err.message);
  }
};

/**
 * Notifies the admin/creator when a payment to a provider is recorded.
 *
 * @param {Object} provider - Provider document { name }
 * @param {Object} payment - ProviderPayment document
 * @param {string} recordedByEmail - Email of the accounting staff
 * @param {string} recordedByName
 */
export const notifyProviderPaymentRecorded = async (
  provider,
  payment,
  recordedByEmail,
  recordedByName,
) => {
  try {
    if (!recordedByEmail) return;

    await sendEmail(
      recordedByEmail,
      `Provider Payment Confirmed — ${provider.name}`,
      `
      <div style="${baseStyle}">
        <h2 style="color:#2c3e50;">Provider Payment Recorded</h2>
        <p>
          A payment of <strong>${payment.amount}</strong> has been recorded
          for provider <strong>${provider.name}</strong>.
        </p>
        <table style="${tableStyle}">
          <tr>
            <td style="${cellStyle}"><strong>Provider</strong></td>
            <td style="${cellStyle}">${provider.name}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Amount</strong></td>
            <td style="${cellStyle}">${payment.amount}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Method</strong></td>
            <td style="${cellStyle}">${payment.method}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Reference</strong></td>
            <td style="${cellStyle}">${payment.reference || "—"}</td>
          </tr>
          <tr>
            <td style="${cellStyle}"><strong>Recorded By</strong></td>
            <td style="${cellStyle}">${recordedByName}</td>
          </tr>
        </table>
        <p style="margin-top:16px;color:#888;font-size:12px;">
          This is an automated notification from the booking system.
        </p>
      </div>
      `,
    );
  } catch (err) {
    console.error(
      "❌ Failed to send provider payment notification:",
      err.message,
    );
  }
};
