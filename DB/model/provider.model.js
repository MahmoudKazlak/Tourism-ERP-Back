import mongoose from "mongoose";
const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["hotel", "car_rental", "driver_company", "tourism"],
      required: true,
    },
    currentSequence: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    phone: String,
    address: String,
  },
  { timestamps: true },
);

export default mongoose.model("Provider", providerSchema);
