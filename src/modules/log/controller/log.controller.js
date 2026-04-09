import logModel from "../../../../DB/model/log.model.js";
import { asyncHandler } from "../../../middleware/asyncHandler.js";
import { pagination } from "../../../services/pagination.js";

// FIX: أضفنا pagination — كان بيرجع كل السجلات بدون حد
export const getAllLogs = asyncHandler(async (req, res, next) => {
  const { action, userId, page, size } = req.query;
  const query = {};
  if (action) query.action = action;
  if (userId) query.user = userId;

  const { limit, skip } = pagination(page, size);

  const [logs, totalCount] = await Promise.all([
    logModel
      .find(query)
      .populate("user", "userName email role")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip),
    logModel.countDocuments(query),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      logs,
    },
    errors: null,
  });
});

export const getLogsByUser = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { page, size } = req.query;
  const { limit, skip } = pagination(page, size);

  const [logs, totalCount] = await Promise.all([
    logModel
      .find({ user: userId })
      .populate("user", "userName email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip),
    logModel.countDocuments({ user: userId }),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { totalCount, totalPages: Math.ceil(totalCount / limit), logs },
    errors: null,
  });
});
