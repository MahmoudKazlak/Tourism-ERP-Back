import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    userName: {
      type: String,
      required: [true, "Username is required"],
      minlength: [3, "Min length is 3"],
      maxlength: [25, "Max length is 25"],
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    phone: String,
    role: {
      type: String,
      enum: ["admin", "booking_staff", "accounting_staff"],
      default: "booking_staff",
    },
    image: String, // Cloudinary URL stored here
    imagePublicId: String, // Cloudinary public_id for deletion
    blocked: {
      type: Boolean,
      default: false,
    },
    // FIX [12]: Replaced the "dontTrust32" sentinel string with explicit
    // nullable fields + an expiry date. Benefits:
    //   - No magic string to leak or misuse.
    //   - Token auto-expires: the controller checks passwordResetExpiry.
    //   - Clear intent — null means "no active reset request".
    passwordResetToken: {
      type: String,
      default: null,
    },
    passwordResetExpiry: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(
    this.password,
    parseInt(process.env.SALTROUND) || 10,
  );
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model("User", userSchema);
