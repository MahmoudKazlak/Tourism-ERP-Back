import mongoose from "mongoose";

const detailFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    fieldType: {
      type: String,
      enum: ["text", "date", "number"],
      default: "text",
    },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

const durationFieldsSchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    unit: { type: String, default: "days" },
  },
  { _id: false },
);

const officeServiceTypeSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    label: { type: String, required: true, trim: true },
    voucherPrefix: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 4,
    },
    durationFields: { type: durationFieldsSchema, default: undefined },
    detailFields: { type: [detailFieldSchema], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

export default mongoose.model("OfficeServiceType", officeServiceTypeSchema);
