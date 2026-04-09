import { asyncHandler } from "../../../middleware/asyncHandler.js";
import expenseModel from "../../../../DB/model/expense.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";

// إضافة مصروف
export const createExpense = asyncHandler(async (req, res, next) => {
  const { category, amount, date, description, method, reference } = req.body;

  const expense = await expenseModel.create({
    category,
    amount,
    date: date || new Date(),
    description,
    method,
    reference,
    recordedBy: req.user._id,
  });

  await logModel.create({
    user: req.user._id,
    action: "CREATE_EXPENSE",
    details: { expenseId: expense._id, category, amount, description },
  });

  return res.status(201).json({
    success: true,
    message: "Expense recorded successfully",
    data: { expense },
    errors: null,
  });
});

// جلب المصاريف مع فلترة وتجميع
export const getAllExpenses = asyncHandler(async (req, res) => {
  const { category, fromDate, toDate, page, size } = req.query;

  const query = {};
  if (category) query.category = category;
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query.date.$lte = to;
    }
  }

  const { limit, skip } = pagination(page, size);

  const [expenses, totalCount, totalByCategory] = await Promise.all([
    expenseModel
      .find(query)
      .populate("recordedBy", "userName")
      .sort({ date: -1 })
      .limit(limit)
      .skip(skip),
    expenseModel.countDocuments(query),
    // تجميع حسب الفئة
    expenseModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const grandTotal = totalByCategory.reduce((s, c) => s + c.total, 0);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      grandTotal,
      byCategory: Object.fromEntries(
        totalByCategory.map((c) => [c._id, { total: c.total, count: c.count }]),
      ),
      expenses,
    },
    errors: null,
  });
});

// تعديل مصروف
export const updateExpense = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const expense = await expenseModel.findByIdAndUpdate(
    id,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!expense) return next(new Error("Expense not found", { cause: 404 }));

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_EXPENSE",
    details: { expenseId: id, updatedFields: Object.keys(req.body) },
  });

  return res.status(200).json({
    success: true,
    message: "Expense updated successfully",
    data: { expense },
    errors: null,
  });
});

// حذف مصروف
export const deleteExpense = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const expense = await expenseModel.findByIdAndDelete(id);
  if (!expense) return next(new Error("Expense not found", { cause: 404 }));

  await logModel.create({
    user: req.user._id,
    action: "DELETE_EXPENSE",
    details: {
      expenseId: id,
      amount: expense.amount,
      category: expense.category,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Expense deleted successfully",
    data: null,
    errors: null,
  });
});

// ─────────────────────────────────────────────
// إغلاق الصندوق اليومي
// يحسب: الكاش الموجود = إجمالي دفعات الكاش - إجمالي مصاريف الكاش
// ─────────────────────────────────────────────
export const getDailyCashClosing = asyncHandler(async (req, res) => {
  // التاريخ: اليوم أو تاريخ محدد
  const targetDate = req.query.date ? new Date(req.query.date) : new Date();

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const dateFilter = { $gte: dayStart, $lte: dayEnd };

  const [cashPayments, cashExpenses, allPayments, allExpenses] =
    await Promise.all([
      // دفعات الكاش اليوم (من الزبائن)
      paymentModel.aggregate([
        { $match: { method: "cash", date: dateFilter } },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),

      // مصاريف الكاش اليوم
      expenseModel.aggregate([
        { $match: { method: "cash", date: dateFilter } },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),

      // كل وسائل الدفع اليوم
      paymentModel.aggregate([
        { $match: { date: dateFilter } },
        {
          $group: {
            _id: "$method",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),

      // كل المصاريف اليوم
      expenseModel.aggregate([
        { $match: { date: dateFilter } },
        {
          $group: {
            _id: "$category",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  const cashIn = cashPayments[0]?.total || 0;
  const cashOut = cashExpenses[0]?.total || 0;
  const cashInDrawer = cashIn - cashOut;

  const totalCollectedToday = allPayments.reduce((s, p) => s + p.total, 0);
  const totalExpensesToday = allExpenses.reduce((s, e) => s + e.total, 0);
  const netForDay = totalCollectedToday - totalExpensesToday;

  return res.status(200).json({
    success: true,
    message: "Daily cash closing report",
    data: {
      date: targetDate.toDateString(),
      cash: {
        in: cashIn,
        out: cashOut,
        inDrawer: cashInDrawer,
        label:
          cashInDrawer >= 0
            ? `في الدرج ${cashInDrawer}`
            : `عجز كاش ${Math.abs(cashInDrawer)}`,
      },
      allIncome: {
        total: totalCollectedToday,
        breakdown: Object.fromEntries(
          allPayments.map((p) => [p._id, { total: p.total, count: p.count }]),
        ),
      },
      allExpenses: {
        total: totalExpensesToday,
        breakdown: Object.fromEntries(
          allExpenses.map((e) => [e._id, { total: e.total, count: e.count }]),
        ),
      },
      netForDay,
      netLabel:
        netForDay >= 0
          ? `صافي ربح اليوم: ${netForDay}`
          : `خسارة اليوم: ${Math.abs(netForDay)}`,
    },
    errors: null,
  });
});
