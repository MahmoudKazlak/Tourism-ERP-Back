import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  // Store only the SHA-256 hash of the raw token, never the token itself.
  // If this collection is ever exposed, the hashes are useless without the raw token.
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Optional: track which device/IP issued this token for audit purposes.
  userAgent: String,
  ip: String,
});

// MongoDB auto-removes documents once expiresAt passes.
// No cron job or manual cleanup required.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("RefreshToken", refreshTokenSchema);
