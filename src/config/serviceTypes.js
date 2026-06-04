/**
 * Service Type Registry
 * ─────────────────────
 * Single source of truth for all booking service types.
 *
 * To add a new permanent service type (e.g., "flightBooking"):
 *   1. Add a new entry to SERVICE_TYPES below.
 *   2. That's it — sequence assignment, financial roll-ups, provider
 *      statements, vouchers, and exports all work automatically.
 *
 * Entry shape:
 *   key           — machine-readable identifier (must match the object key)
 *   label         — human-readable display name for reports / UI
 *   voucherPrefix — short prefix used in voucher/service numbers (e.g. "ACC")
 *   durationFields— optional; when present, `duration` is auto-calculated
 *                   from details[from] to details[to] (result stored in days/nights)
 */
export const SERVICE_TYPES = {
  accommodation: {
    key: "accommodation",
    label: "Hotel Accommodation",
    voucherPrefix: "ACC",
    durationFields: { from: "checkIn", to: "checkOut", unit: "nights" },
  },
  carRental: {
    key: "carRental",
    label: "Car Rental",
    voucherPrefix: "CAR",
    durationFields: { from: "pickUp", to: "dropOff", unit: "days" },
  },
  carWithDriver: {
    key: "carWithDriver",
    label: "Car with Driver",
    voucherPrefix: "CWD",
  },
  apartRent: {
    key: "apartRent",
    label: "Apartment Rental",
    voucherPrefix: "APT",
    durationFields: { from: "checkIn", to: "checkOut", unit: "nights" },
  },
  trip: {
    key: "trip",
    label: "Trip / Excursion",
    voucherPrefix: "TRP",
  },
};

/** Valid serviceType string values — consumed by Joi validators and Mongoose enum. */
export const SERVICE_TYPE_KEYS = Object.keys(SERVICE_TYPES);

/**
 * Returns a concise human-readable description of a service line.
 * Used in statements, ledgers, and vouchers.
 *
 * @param {object} service - A service subdocument from booking.services
 * @returns {string}
 */
export const describeService = (service) => {
  const d = service.details || {};
  const typeDef = SERVICE_TYPES[service.serviceType];

  switch (service.serviceType) {
    case "accommodation":
    case "apartRent": {
      const parts = [];
      if (d.roomType) parts.push(d.roomType);
      if (d.board) parts.push(d.board);
      if (service.duration != null)
        parts.push(
          `${service.duration} ${typeDef?.durationFields?.unit ?? "nights"}`,
        );
      return parts.join(" / ") || typeDef?.label || service.serviceType;
    }
    case "carRental":
      return [
        d.brand,
        d.pickUp ? `From: ${new Date(d.pickUp).toLocaleDateString()}` : null,
      ]
        .filter(Boolean)
        .join(" — ");
    case "carWithDriver":
      return [d.brand, d.driverName ? `Driver: ${d.driverName}` : null]
        .filter(Boolean)
        .join(" — ");
    case "trip":
      return [
        d.destination,
        d.date ? new Date(d.date).toLocaleDateString() : null,
      ]
        .filter(Boolean)
        .join(" — ");
    default: {
      // Generic fallback: show first few detail key-value pairs
      const entries = Object.entries(d).slice(0, 3);
      return entries.length > 0
        ? entries.map(([k, v]) => `${k}: ${v}`).join(", ")
        : typeDef?.label || service.serviceType;
    }
  }
};
