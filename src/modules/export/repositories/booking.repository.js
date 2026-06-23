import bookingModel from "../../../../DB/model/booking.model.js";

const BATCH = 500;

export const streamBookings = () =>
  bookingModel
    .find({})
    .sort({ bookingID: 1 })
    .populate("provider",  "name type")
    .populate("createdBy", "userName")
    .select("-__v -updatedAt")
    .lean()
    .cursor({ batchSize: BATCH });

/** MongoDB handles the array-flattening server-side via $unwind —
 *  Node never holds a full booking with all its services in memory. */
export const streamServices = () =>
  bookingModel.aggregate([
    { $unwind: "$services" },
    { $lookup: { from: "providers", localField: "services.provider", foreignField: "_id", as: "svcProvider" } },
    { $project: {
        bookingID:     1,
        bookingDate:   "$createdAt",
        bookingStatus: "$status",
        customer:      { $arrayElemAt: ["$customers.name", 0] },
        serviceType:   "$services.serviceType",
        serviceNumber: "$services.serviceNumber",
        providerName:  { $arrayElemAt: ["$svcProvider.name", 0] },
        buy:           "$services.buy",
        sell:          "$services.sell",
        profit:        "$services.profit",
        duration:      "$services.duration",
        details:       "$services.details",
    }},
    { $sort: { bookingID: 1, serviceNumber: 1 } },
  ])
  .allowDiskUse(true)
  .cursor({ batchSize: BATCH });

export const getBookingSummary = () =>
  bookingModel.aggregate([{ $group: {
    _id: null,
    totalBookings:    { $sum: 1 },
    totalRevenue:     { $sum: "$totalToPay"       },
    totalCost:        { $sum: "$totalToBuy"       },
    totalProfit:      { $sum: "$totalProfit"      },
    totalPaid:        { $sum: "$totalPaid"        },
    totalOutstanding: { $sum: "$remainingBalance" },
  }}]);
