import { asyncHandler } from "../../../middleware/asyncHandler.js";
import providerCollectionModel from "../../../../DB/model/providerCollection.model.js";
import providerModel from "../../../../DB/model/provider.model.js";
import paymentModel from "../../../../DB/model/payment.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { pagination } from "../../../services/pagination.js";
import { applyProviderSummaryDelta } from "../../../services/providerSummaryService.js";
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute how much a provider currently owes our agency
// ─────────────────────────────────────────────────────────────────────────────
const computeProviderOwesUs = async (providerId) => {
  const providerObjId = new mongoose.Types.ObjectId(providerId);

  const bookings = await mongoose
    .model("Booking")
    .find({
      $or: [
        { provider: providerObjId },
        { "services.provider": providerObjId },
      ],
    })
    .lean();

  let totalServiceCost = 0;
  for (const booking of bookings) {
    for (const service of booking.services || []) {
      if (service.provider?.toString() === providerId) {
        totalServiceCost += Number(service.buy) || 0;
      }
    }
  }

  const [provPayAgg, directPayAgg, collectionAgg] = await Promise.all([
    mongoose
      .model("ProviderPayment")
      .aggregate([
        { $match: { provider: providerObjId } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    paymentModel.aggregate([
      { $match: { providerRecipient: providerObjId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    providerCollectionModel.aggregate([
      { $match: { provider: providerObjId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const agencyPaymentsToProvider = provPayAgg[0]?.total || 0;
  const customerDirectPayments = directPayAgg[0]?.total || 0;
  const alreadyCollected = collectionAgg[0]?.total || 0;

  const balance =
    totalServiceCost -
    agencyPaymentsToProvider -
    customerDirectPayments +
    alreadyCollected;

  const providerOwesUs = balance < 0 ? Math.abs(balance) : 0;
  return { balance, providerOwesUs, alreadyCollected };
};

// ─────────────────────────────────────────────────────────────────────────────
// Record a collection received FROM a provider
// POST /api/v1/provider-collection/:providerId
// ─────────────────────────────────────────────────────────────────────────────
export const createProviderCollection = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { amount, date, method, notes, reference, booking } = req.body;

  const provider = await providerModel.findById(providerId);
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  const { balance } = await computeProviderOwesUs(providerId);
  const providerOwesUs = balance < 0 ? Math.abs(balance) : 0;

  if (providerOwesUs === 0 && balance >= 0) {
    return next(
      new Error(
        `Provider "${provider.name}" does not currently hold a receivable balance. ` +
          "Collections can only be recorded when the provider owes the agency money " +
          "(i.e., they collected from a customer on the agency's behalf).",
        { cause: 400 },
      ),
    );
  }

  const numAmount = Number(amount);

  if (numAmount > providerOwesUs) {
    return next(
      new Error(
        `Collection amount ($${numAmount}) exceeds the outstanding balance ` +
          `($${providerOwesUs.toFixed(2)}) that ${provider.name} owes the agency. ` +
          "Record a collection no greater than the outstanding balance.",
        { cause: 400 },
      ),
    );
  }

  const collection = await providerCollectionModel.create({
    provider: providerId,
    amount: numAmount,
    date: date || new Date(),
    method: method || "cash",
    notes,
    reference,
    booking: booking || null,
    recordedBy: req.user._id,
  });

  await logModel.create({
    user: req.user._id,
    action: "CREATE_PROVIDER_COLLECTION",
    details: {
      collectionId: collection._id,
      providerId,
      providerName: provider.name,
      amount: numAmount,
      method,
      previousOwed: providerOwesUs,
      remainingOwed: providerOwesUs - numAmount,
    },
  });

  return res.status(201).json({
    success: true,
    message: `Collection of $${numAmount} from ${provider.name} recorded successfully`,
    data: {
      collection,
      balanceSummary: {
        previouslyOwed: providerOwesUs,
        collected: numAmount,
        remainingOwed: +(providerOwesUs - numAmount).toFixed(2),
      },
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Edit a provider collection (Admin only)
// PATCH /api/v1/provider-collection/:collectionId
//
// Mirrors editProviderPayment: the model's post-save hook only increments the
// summary on document CREATION (isNew), so saving an existing document here
// is a no-op for that hook — the amount delta must be pushed manually via
// applyProviderSummaryDelta.
// ─────────────────────────────────────────────────────────────────────────────
export const editProviderCollection = asyncHandler(async (req, res, next) => {
  const { collectionId } = req.params;
  const { amount, date, method, notes, reference, booking } = req.body;

  const collection = await providerCollectionModel
    .findById(collectionId)
    .populate("provider", "name");
  if (!collection) return next(new Error("Collection not found", { cause: 404 }));

  if (booking) {
    // mongoose.model("Booking") — matches the existing pattern already used
    // in computeProviderOwesUs() in this same file, avoids adding a new import.
    const bookingExists = await mongoose.model("Booking").exists({ _id: booking });
    if (!bookingExists)
      return next(new Error("Booking not found", { cause: 404 }));
  }

  const oldAmount = collection.amount;
  const newAmount = amount !== undefined ? Number(amount) : oldAmount;
  const amountChanged = newAmount !== oldAmount;

  if (amount !== undefined) collection.amount = newAmount;
  if (date !== undefined) collection.date = date;
  if (method !== undefined) collection.method = method;
  if (notes !== undefined) collection.notes = notes;
  if (reference !== undefined) collection.reference = reference;
  if (booking !== undefined) collection.booking = booking || null;

  await collection.save();

  if (amountChanged) {
    await applyProviderSummaryDelta(
      collection.provider._id,
      { totalCollectedFromProvider: newAmount - oldAmount },
      "providerCollection_edit",
    );
  }

  await logModel.create({
    user: req.user._id,
    action: "EDIT_PROVIDER_COLLECTION",
    details: {
      collectionId,
      providerId: collection.provider._id,
      providerName: collection.provider?.name,
      // NEW
      changes: {
        ...(amountChanged && { amount: { from: oldAmount, to: newAmount } }),
        ...(method !== undefined && { method }),
        ...(date !== undefined && { date }),
        ...(notes !== undefined && { notes }),
        ...(reference !== undefined && { reference }),
        ...(booking !== undefined && { booking }),
      },
    },
  });

  return res.status(200).json({
    success: true,
    message: "Provider collection updated successfully",
    data: { collection },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all collections from a specific provider (paginated)
// GET /api/v1/provider-collection/:providerId
//
// FIX Bug 4: the "total" aggregate now uses the same date-filtered query as
// the paginated list, so the two figures are always consistent.
// An allTimeTotalCollected field is included for reference.
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderCollections = asyncHandler(async (req, res, next) => {
  const { providerId } = req.params;
  const { fromDate, toDate, page, size } = req.query;

  const provider = await providerModel.findById(providerId).lean();
  if (!provider) return next(new Error("Provider not found", { cause: 404 }));

  // Build query — shared by list, count, and filtered total
  const query = { provider: providerId };
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

  const [collections, totalCount, filteredTotalResult, allTimeTotalResult] =
    await Promise.all([
      providerCollectionModel
        .find(query)
        .populate("recordedBy", "userName")
        .populate("booking", "bookingID customers referenceCode")
        .sort({ date: -1 })
        .limit(limit)
        .skip(skip),
      providerCollectionModel.countDocuments(query),

      // Filtered total — consistent with the paginated list
      providerCollectionModel.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      // All-time total — always the full lifetime sum for this provider
      providerCollectionModel.aggregate([
        { $match: { provider: new mongoose.Types.ObjectId(providerId) } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

  const { balance } = await computeProviderOwesUs(providerId);
  const providerOwesUs = balance < 0 ? Math.abs(balance) : 0;
  const isFiltered = Boolean(fromDate || toDate);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      provider: { id: provider._id, name: provider.name, type: provider.type },
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      totalCollected: filteredTotalResult[0]?.total || 0,
      allTimeTotalCollected: allTimeTotalResult[0]?.total || 0,
      isFiltered,
      currentOutstandingBalance: providerOwesUs,
      collections,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get all collections — accounting overview
// GET /api/v1/provider-collection/all
// ─────────────────────────────────────────────────────────────────────────────
export const getAllProviderCollections = asyncHandler(async (req, res) => {
  const { method, fromDate, toDate, page, size } = req.query;

  const query = {};
  if (method) query.method = method;
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

  const [collections, totalCount, totalAmountResult] = await Promise.all([
    // NEW
    providerCollectionModel
      .find(query)
      .populate("provider", "name type")
      .populate("recordedBy", "userName")
      .populate("booking", "bookingID customers referenceCode")
      .sort({ date: -1 })
      .limit(limit)
      .skip(skip),
    providerCollectionModel.countDocuments(query),
    providerCollectionModel.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      totalAmount: totalAmountResult[0]?.total || 0,
      collections,
    },
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete a collection (Admin only)
// DELETE /api/v1/provider-collection/:collectionId
// ─────────────────────────────────────────────────────────────────────────────
export const deleteProviderCollection = asyncHandler(async (req, res, next) => {
  const { collectionId } = req.params;

  const collection = await providerCollectionModel
    .findById(collectionId)
    .populate("provider", "name");
  if (!collection)
    return next(new Error("Collection not found", { cause: 404 }));

  await collection.deleteOne();

  await logModel.create({
    user: req.user._id,
    action: "DELETE_PROVIDER_COLLECTION",
    details: {
      collectionId,
      providerId: collection.provider._id,
      providerName: collection.provider?.name,
      amount: collection.amount,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Provider collection deleted successfully",
    data: null,
    errors: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Get a single provider collection by ID
// GET /api/v1/provider-collection/collection/:collectionId
// ─────────────────────────────────────────────────────────────────────────────
export const getProviderCollectionById = asyncHandler(async (req, res, next) => {
  const { collectionId } = req.params;

  // NEW
  const collection = await providerCollectionModel
    .findById(collectionId)
    .populate("provider", "name type phone")
    .populate("booking", "bookingID customers referenceCode")
    .populate("recordedBy", "userName");

  if (!collection)
    return next(new Error("Collection not found", { cause: 404 }));

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { collection },
    errors: null,
  });
});

// NEW — add after getProviderCollectionById
/**
 * Streams a PDFKit-based receipt for a provider collection.
 * GET /api/v1/provider-collection/collection/:collectionId/receipt
 */
export const downloadProviderCollectionReceipt = asyncHandler(async (req, res, next) => {
  const { collectionId } = req.params;

  const collection = await providerCollectionModel
    .findById(collectionId)
    .populate("provider", "name")
    .populate("booking", "bookingID referenceCode")
    .populate("recordedBy", "userName")
    .lean();

  if (!collection) return next(new Error("Collection not found", { cause: 404 }));

  const officeSettingsModel = (await import("../../../../DB/model/officeSettings.model.js")).default;
  const officeSettings = await officeSettingsModel.findOne().lean();

  const receipt = {
    receiptType:   "PROVIDER COLLECTION",
    receiptNumber: `REC-${collection._id.toString().slice(-8).toUpperCase()}`,
    issueDate:     new Date(),
    amount:        collection.amount,
    method:        collection.method,
    date:          collection.date,
    reference:     collection.reference || null,
    notes:         collection.notes     || null,
    booking:       collection.booking
      ? { bookingID: collection.booking.bookingID, referenceCode: collection.booking.referenceCode }
      : null,
    entity: { label: "Provider", name: collection.provider?.name || "—" },
    recordedBy: collection.recordedBy?.userName || "—",
  };

  const { generateReceiptPdfBuffer } = await import("../../../services/receiptPdfService.js");
  const buffer = await generateReceiptPdfBuffer(receipt, officeSettings);

  const filename = `receipt-collection-${collection._id.toString().slice(-8)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  return res.end(buffer);
});