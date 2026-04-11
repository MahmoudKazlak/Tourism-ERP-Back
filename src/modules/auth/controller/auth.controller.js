import crypto from "crypto";
import sendEmail from "../../../services/email.js";
import { uploadImage, deleteImage } from "../../../services/cloudinary.js";
import jwt from "jsonwebtoken";
import userModel from "../../../../DB/model/user.model.js";
import logModel from "../../../../DB/model/log.model.js";
import refreshTokenModel from "../../../../DB/model/refreshToken.model.js";
import { nanoid } from "nanoid";
import { asyncHandler } from "../../../middleware/asyncHandler.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "1h";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/** Creates a signed JWT access token. */
const signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.SIGNINTOKEN, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

/**
 * Creates a raw refresh token, stores its SHA-256 hash in the DB,
 * and returns the raw token (sent to the client once, never stored raw).
 */
const createRefreshToken = async (userId, req) => {
  const raw = crypto.randomBytes(40).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");

  await refreshTokenModel.create({
    user: userId,
    tokenHash: hash,
    expiresAt: new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ),
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });

  return raw;
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const signIn = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await userModel.findOne({ email });
  if (!user)
    return next(new Error("Invalid login credentials", { cause: 400 }));

  const isMatch = await user.comparePassword(password);
  if (!isMatch)
    return next(new Error("Invalid login credentials", { cause: 400 }));

  if (user.blocked) {
    return res
      .status(403)
      .json({ success: false, message: "Account is blocked" });
  }

  const accessToken = signAccessToken(user._id);
  const refreshToken = await createRefreshToken(user._id, req);

  return res.status(200).json({
    success: true,
    message: "Login successfully",
    data: {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      user: {
        id: user._id,
        userName: user.userName,
        email: user.email,
        role: user.role,
        image: user.image || null,
      },
    },
    errors: null,
  });
});

// Feature [4]: Issue a new access token using a valid refresh token.
export const refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken: rawToken } = req.body;
  if (!rawToken)
    return next(new Error("Refresh token is required", { cause: 400 }));

  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const storedToken = await refreshTokenModel.findOne({ tokenHash: hash });

  if (!storedToken) {
    return next(new Error("Invalid or expired refresh token", { cause: 401 }));
  }

  if (storedToken.expiresAt < new Date()) {
    await storedToken.deleteOne();
    return next(
      new Error("Refresh token expired. Please log in again.", { cause: 401 }),
    );
  }

  const user = await userModel
    .findById(storedToken.user)
    .select("_id role blocked");
  if (!user || user.blocked) {
    await storedToken.deleteOne();
    return next(new Error("User unavailable", { cause: 401 }));
  }

  const accessToken = signAccessToken(user._id);

  return res.status(200).json({
    success: true,
    message: "Access token refreshed",
    data: { accessToken, expiresIn: ACCESS_TOKEN_EXPIRY },
    errors: null,
  });
});

// Feature [4]: Invalidate a refresh token on logout.
export const logout = asyncHandler(async (req, res, next) => {
  const { refreshToken: rawToken } = req.body;
  if (rawToken) {
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await refreshTokenModel.deleteOne({ tokenHash: hash });
  }

  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
    data: null,
    errors: null,
  });
});

// FIX [12] + FIX [10]: Uses passwordResetToken/passwordResetExpiry instead of
// the "dontTrust32" sentinel. Authorization uses Bearer header.
export const sendCode = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await userModel.findOne({ email }).select("_id email");
  if (!user) {
    // Do not reveal whether the email exists (security best practice).
    return res.status(200).json({
      success: true,
      message: "If this email exists, a reset code has been sent.",
      data: null,
      errors: null,
    });
  }

  const code = nanoid(8);
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await sendEmail(
    email,
    "Password Reset Code",
    `<p>Your password reset code: <b>${code}</b></p>
     <p>This code expires in <strong>1 hour</strong>.</p>`,
  );

  await userModel.updateOne(
    { _id: user._id },
    { passwordResetToken: code, passwordResetExpiry: expiry },
  );

  // The JWT here is just to identify which user the OTP belongs to.
  // It does NOT grant any access — only the OTP + this JWT together work.
  const token = jwt.sign({ id: user._id }, process.env.FORGOTPASSWORDTOKEN, {
    expiresIn: "1h",
  });

  return res.status(200).json({
    success: true,
    message: "If this email exists, a reset code has been sent.",
    data: { token },
    errors: null,
  });
});

// FIX [12] + FIX [10]: Reads standard Authorization header; validates
// OTP against passwordResetToken and checks passwordResetExpiry.
export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { otp, email, newPassword } = req.body;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new Error("Authorization header required", { cause: 400 }));
  }

  const rawToken = authHeader.slice(7).trim();
  const decoded = jwt.verify(rawToken, process.env.FORGOTPASSWORDTOKEN);

  if (!otp || !decoded) {
    return next(new Error("Invalid request", { cause: 400 }));
  }

  const user = await userModel.findOne({
    email,
    passwordResetToken: otp,
    _id: decoded.id,
  });

  if (!user) {
    return next(new Error("Invalid OTP or email", { cause: 400 }));
  }

  if (user.passwordResetExpiry < new Date()) {
    return next(
      new Error("OTP has expired. Request a new one.", { cause: 400 }),
    );
  }

  // pre('save') hashes the password — no manual bcrypt.hash() needed.
  user.password = newPassword;
  user.passwordResetToken = null;
  user.passwordResetExpiry = null;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password changed successfully",
    data: null,
    errors: null,
  });
});

export const createUser = asyncHandler(async (req, res, next) => {
  const { userName, email, password, role } = req.body;

  const exists = await userModel.findOne({ email }).select("_id");
  if (exists) {
    return res
      .status(409)
      .json({ success: false, message: "Email already exists" });
  }

  const savedUser = await userModel.create({ userName, email, password, role });

  await logModel.create({
    user: req.user._id,
    action: "CREATE_USER",
    details: {
      userId: savedUser._id,
      userName: savedUser.userName,
      email: savedUser.email,
      role: savedUser.role,
    },
  });

  return res.status(201).json({
    success: true,
    message: "User created successfully",
    data: { user_id: savedUser._id },
    errors: null,
  });
});

export const updateUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // These fields must never be set through this endpoint.
  const protectedFields = [
    "_id",
    "passwordResetToken",
    "passwordResetExpiry",
    "image",
    "imagePublicId",
  ];

  const user = await userModel.findById(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  const passwordChanged = Boolean(req.body.password);

  for (const [key, value] of Object.entries(req.body)) {
    if (
      !protectedFields.includes(key) &&
      key !== "cPassword" &&
      value != null
    ) {
      user[key] = value;
    }
  }

  await user.save();

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_USER",
    details: {
      userId: id,
      updatedFields: Object.keys(req.body).filter(
        (k) =>
          !protectedFields.includes(k) && k !== "password" && k !== "cPassword",
      ),
      passwordChanged,
    },
  });

  const safeUser = user.toObject();
  delete safeUser.password;
  delete safeUser.passwordResetToken;
  delete safeUser.passwordResetExpiry;

  return res.status(200).json({
    success: true,
    message: "User updated successfully",
    data: { user: safeUser },
    errors: null,
  });
});

export const getAllUsers = asyncHandler(async (req, res, next) => {
  const { role, blocked } = req.query;
  const query = {};
  if (role) query.role = role;
  if (blocked !== undefined) query.blocked = blocked === "true";

  const users = await userModel
    .find(query)
    .select("-password -passwordResetToken -passwordResetExpiry")
    .sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { count: users.length, users },
    errors: null,
  });
});

// Feature [5]: Upload a user's profile image to Cloudinary.
export const uploadUserImage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!req.file) {
    return next(new Error("No image file provided", { cause: 400 }));
  }

  // Verify the target user exists before uploading.
  const user = await userModel.findById(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  // Delete the old Cloudinary image if one exists.
  if (user.imagePublicId) {
    await deleteImage(user.imagePublicId).catch((e) =>
      console.warn("⚠️  Could not delete old Cloudinary image:", e.message),
    );
  }

  const result = await uploadImage(req.file.buffer, "profiles");

  user.image = result.secure_url;
  user.imagePublicId = result.public_id;
  await user.save();

  await logModel.create({
    user: req.user._id,
    action: "UPLOAD_USER_IMAGE",
    details: { targetUserId: id, cloudinaryPublicId: result.public_id },
  });

  return res.status(200).json({
    success: true,
    message: "Profile image uploaded successfully",
    data: { imageUrl: result.secure_url },
    errors: null,
  });
});
