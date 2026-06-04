import { SERVICE_TYPES, SERVICE_TYPE_KEYS } from "../config/serviceTypes.js";
import OfficeServiceType from "../../DB/model/officeServiceType.model.js";

let mergedTypes = { ...SERVICE_TYPES };
let mergedKeys = [...SERVICE_TYPE_KEYS];

export const getMergedServiceTypes = () => mergedTypes;
export const getMergedServiceTypeKeys = () => mergedKeys;

const shapeOfficeType = (doc) => ({
  key: doc.key,
  label: doc.label,
  voucherPrefix: doc.voucherPrefix,
  durationFields: doc.durationFields?.from ? doc.durationFields : undefined,
  detailFields: doc.detailFields ?? [],
  source: "office",
});

export const refreshServiceTypeRegistry = async () => {
  const custom = await OfficeServiceType.find({ isActive: true }).lean();

  mergedTypes = { ...SERVICE_TYPES };
  for (const doc of custom) {
    mergedTypes[doc.key] = shapeOfficeType(doc);
  }
  mergedKeys = Object.keys(mergedTypes);
};

export const listServiceTypesForApi = () => {
  const types = {};
  for (const key of mergedKeys) {
    const def = mergedTypes[key];
    types[key] = {
      key,
      label: def.label,
      voucherPrefix: def.voucherPrefix,
      durationFields: def.durationFields ?? null,
      detailFields: def.detailFields ?? [],
      source: SERVICE_TYPES[key] ? "builtin" : "office",
    };
  }
  return { types, keys: mergedKeys };
};
