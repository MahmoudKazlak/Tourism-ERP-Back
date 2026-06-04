import mongoose from "mongoose";

/**
 * Simple atomic counter collection.
 * Each document is identified by a string _id (e.g. "booking").
 *
 * Usage:
 *   const counter = await counterModel.findOneAndUpdate(
 *     { _id: "booking" },
 *     { $inc: { seq: 1 } },
 *     { new: true, upsert: true },
 *   );
 *   const nextId = counter.seq;
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // counter name, e.g. "booking"
  seq: { type: Number, default: 0 },
});

export default mongoose.model("Counter", counterSchema);
