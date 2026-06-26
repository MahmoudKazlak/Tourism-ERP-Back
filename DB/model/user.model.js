import mongoose from "mongoose";
import bcrypt    from "bcrypt";
import { ALL_ROLES, ROLES } from "../../src/config/roles.js";

/**
 * User model.
 *
 * The role enum is derived from ALL_ROLES (src/config/roles.js) — the single
 * source of truth. Adding a new role to the config automatically expands this
 * enum without editing this file.
 */
const userSchema = new mongoose.Schema(
  {
    userName: {
      type:      String,
      required:  [true, "Username is required"],
      minlength: [3,  "Min length is 3"],
      maxlength: [25, "Max length is 25"],
      trim:      true,
    },
    email: {
      type:      String,
      unique:    true,
      required:  [true, "Email is required"],
      lowercase: true,
      trim:      true,
    },
    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: 6,
    },
    phone: String,
    role: {
      type:    String,
      enum:    ALL_ROLES,           // derived from roles.js — no magic strings here
      default: ROLES.BOOKING_STAFF, // new users default to least-privilege role
    },
    image:         String, // Cloudinary secure URL
    imagePublicId: String, // Cloudinary public_id (needed for deletion)
    blocked: {
      type:    Boolean,
      default: false,
    },
    // Null means "no active reset request". Expiry is enforced in the controller
    // so the token auto-invalidates without requiring a background job.
    passwordResetToken:  { type: String, default: null },
    passwordResetExpiry: { type: Date,   default: null },
  },
  { timestamps: true },
);

// ── Hooks ─────────────────────────────────────────────────────────────────────

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(
    this.password,
    parseInt(process.env.SALTROUND) || 10,
  );
});

// ── Instance methods ──────────────────────────────────────────────────────────

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model("User", userSchema);
