import expenseModel from "../../../../DB/model/expense.model.js";

const BATCH = 500;

export const streamExpenses = () =>
  expenseModel.find({}).sort({ date: 1 })
    .populate("recordedBy", "userName")
    .select("-__v").lean().cursor({ batchSize: BATCH });

export const getExpenseSummary = () =>
  expenseModel.aggregate([{ $group: {
    _id:   null,
    total: { $sum: "$amount" },
    count: { $sum: 1 },
  }}]);
