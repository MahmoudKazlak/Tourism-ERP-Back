import mongoose from "mongoose";

const logSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    details: { type: Object },
    ip: String,
  },
  { timestamps: true },
);

export default mongoose.model("Log", logSchema);
