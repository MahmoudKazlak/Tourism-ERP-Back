import mongoose from "mongoose";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import bookingModel from "../../../../DB/model/booking.model.js";
import { pagination } from "../../../services/pagination.js";

/**
 * GET /api/v1/booking/all-services
 *
 * Returns a flat list of service line-items across all bookings.
 * Each row represents one service, enriched with its parent booking context.
 *
 * Query params:
 *   customerName  — partial match on booking customer name
 *   provider      — filter by service provider ID (not the main booking provider)
 *   serviceType   — filter by service type
 *   fromDate      — filter bookings created on or after this date
 *   toDate        — filter bookings created on or before this date
 *   page, size    — pagination
 */
export const getAllServices = asyncHandler(async (req, res) => {
  const { customerName, provider, serviceType, fromDate, toDate, page, size } =
    req.query;

  const { limit, skip } = pagination(page, size);

  // ── Stage 1: match at booking level ────────────────────────────────────────
  const bookingMatch = {};
  if (customerName) {
    bookingMatch["customers.name"] = {
      $regex: customerName.trim(),
      $options: "i",
    };
  }
  if (fromDate || toDate) {
    bookingMatch.createdAt = {};
    if (fromDate) bookingMatch.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      bookingMatch.createdAt.$lte = to;
    }
  }

  // ── Stage 3: match at service level (after $unwind) ────────────────────────
  const serviceMatch = {};
  if (provider) {
    serviceMatch["services.provider"] = new mongoose.Types.ObjectId(provider);
  }
  if (serviceType) {
    serviceMatch["services.serviceType"] = serviceType;
  }

  const pipeline = [
    { $match: bookingMatch },
    { $unwind: "$services" },
    ...(Object.keys(serviceMatch).length ? [{ $match: serviceMatch }] : []),

    // Lookup service provider details
    {
      $lookup: {
        from: "providers",
        localField: "services.provider",
        foreignField: "_id",
        as: "_svcProv",
      },
    },

    // Lookup main booking provider details
    {
      $lookup: {
        from: "providers",
        localField: "provider",
        foreignField: "_id",
        as: "_mainProv",
      },
    },

    {
      $project: {
        bookingID:    1,
        status:       1,
        paymentStatus:1,
        createdAt:    1,
        customers:    1,
        mainProvider: { $arrayElemAt: ["$_mainProv", 0] },
        service: {
          _id:          "$services._id",
          serviceType:  "$services.serviceType",
          serviceNumber:"$services.serviceNumber",
          buy:          "$services.buy",
          sell:         "$services.sell",
          profit:       "$services.profit",
          duration:     "$services.duration",
          details:      "$services.details",
          provider:     { $arrayElemAt: ["$_svcProv", 0] },
        },
      },
    },

    // Sort: bookingID ascending, then serviceNumber ascending
    { $sort: { bookingID: 1, "service.serviceNumber": 1 } },

    // Paginate + count in one round-trip
    {
      $facet: {
        data:  [{ $skip: skip }, { $limit: limit }],
        count: [{ $count: "n" }],
      },
    },
  ];

  const [result] = await bookingModel.aggregate(pipeline);
  const services   = result?.data ?? [];
  const totalCount = result?.count?.[0]?.n ?? 0;

  return res.status(200).json({
    success: true,
    message: "Services retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page:       parseInt(page) || 1,
      services,
    },
    errors: null,
  });
});
