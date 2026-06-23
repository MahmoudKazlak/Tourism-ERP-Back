import userModel from "../../../../DB/model/user.model.js";

const BATCH = 200;

/** Passwords excluded at the query layer — not just in the serialiser. */
export const streamUsers = () =>
  userModel.find({}).sort({ createdAt: 1 })
    .select("-password -passwordResetToken -passwordResetExpiry -__v")
    .lean().cursor({ batchSize: BATCH });

export const getUserSummary = () =>
  userModel.aggregate([{ $group: {
    _id:     "$role",
    count:   { $sum: 1 },
    blocked: { $sum: { $cond: ["$blocked", 1, 0] } },
  }}]);
