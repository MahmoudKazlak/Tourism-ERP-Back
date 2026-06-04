import { asyncHandler } from "../../../middleware/asyncHandler.js";
import OfficeServiceType from "../../../../DB/model/officeServiceType.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { SERVICE_TYPE_KEYS } from "../../../config/serviceTypes.js";
import {
  listServiceTypesForApi,
  refreshServiceTypeRegistry,
} from "../../../services/serviceTypeRegistry.js";

export const getServiceTypes = asyncHandler(async (req, res) => {
  const officeTypes = await OfficeServiceType.find().sort({ label: 1 }).lean();
  const { types, keys } = listServiceTypesForApi();

  return res.status(200).json({
    success: true,
    message: "Service types retrieved successfully",
    data: {
      types,
      keys,
      officeTypes,
      builtinKeys: SERVICE_TYPE_KEYS,
    },
    errors: null,
  });
});

export const createOfficeServiceType = asyncHandler(async (req, res, next) => {
  const { key, label, voucherPrefix, durationFields, detailFields } = req.body;

  const exists = await OfficeServiceType.findOne({ key: key.toLowerCase() });
  if (exists) {
    const err = new Error(`Service type key "${key}" already exists`);
    err.cause = 409;
    return next(err);
  }

  const doc = await OfficeServiceType.create({
    key: key.toLowerCase(),
    label,
    voucherPrefix: voucherPrefix.toUpperCase(),
    durationFields: durationFields?.from ? durationFields : undefined,
    detailFields: detailFields ?? [],
    createdBy: req.user._id,
  });

  await refreshServiceTypeRegistry();

  await logModel.create({
    user: req.user._id,
    action: "CREATE_OFFICE_SERVICE_TYPE",
    details: { key: doc.key, label: doc.label },
  });

  return res.status(201).json({
    success: true,
    message: "Office service type created successfully",
    data: { officeServiceType: doc },
    errors: null,
  });
});

export const updateOfficeServiceType = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const updates = { ...req.body };

  if (updates.voucherPrefix) {
    updates.voucherPrefix = updates.voucherPrefix.toUpperCase();
  }
  if (updates.durationFields === null) {
    updates.durationFields = undefined;
  }

  const doc = await OfficeServiceType.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });

  if (!doc) {
    const err = new Error("Office service type not found");
    err.cause = 404;
    return next(err);
  }

  await refreshServiceTypeRegistry();

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_OFFICE_SERVICE_TYPE",
    details: { id: doc._id, key: doc.key },
  });

  return res.status(200).json({
    success: true,
    message: "Office service type updated successfully",
    data: { officeServiceType: doc },
    errors: null,
  });
});

export const deleteOfficeServiceType = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const doc = await OfficeServiceType.findByIdAndDelete(id);
  if (!doc) {
    const err = new Error("Office service type not found");
    err.cause = 404;
    return next(err);
  }

  await refreshServiceTypeRegistry();

  await logModel.create({
    user: req.user._id,
    action: "DELETE_OFFICE_SERVICE_TYPE",
    details: { key: doc.key, label: doc.label },
  });

  return res.status(200).json({
    success: true,
    message: "Office service type removed successfully",
    data: null,
    errors: null,
  });
});
