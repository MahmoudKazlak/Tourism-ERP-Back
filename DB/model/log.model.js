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

// Auto-delete logs after LOG_RETENTION_DAYS (default 90).
// MongoDB handles this natively — no cron job needed.
// To keep logs forever, set LOG_RETENTION_DAYS=0 in env (TTL won't apply at 0 seconds
// but you can remove the index entirely in that case).
const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 90;
logSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: retentionDays * 24 * 60 * 60 },
);

export default mongoose.model("Log", logSchema);
