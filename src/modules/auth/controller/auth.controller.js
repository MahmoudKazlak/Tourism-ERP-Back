import crypto       from "crypto";
import jwt           from "jsonwebtoken";
import { nanoid }    from "nanoid";
import { asyncHandler }   from "../../../middleware/asyncHandler.js";
import { pagination }     from "../../../services/pagination.js";
import { ROLES }          from "../../../config/roles.js";
import { uploadImage, deleteImage } from "../../../services/cloudinary.js";
import sendEmail          from "../../../services/email.js";
import userModel          from "../../../../DB/model/user.model.js";
import logModel           from "../../../../DB/model/log.model.js";
import refreshTokenModel  from "../../../../DB/model/refreshToken.model.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY       = process.env.ACCESS_TOKEN_EXPIRY || "1h";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// Cookie scoped to the auth sub-path — never sent to /booking, /provider, etc.
const REFRESH_COOKIE_PATH = `${process.env.BASEURL || "/api/v1"}/auth`;

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge:   REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  path:     REFRESH_COOKIE_PATH,
};

// Allowlist for fields an admin may change on another user.
// Anything not in this array is silently ignored — prevents privilege
// escalation via injected fields (Phase 1 security fix).
const ADMIN_UPDATABLE_USER_FIELDS = [
  "userName", "email", "password", "role", "blocked", "phone",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const signAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.SIGNINTOKEN, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

const createRefreshToken = async (userId, req) => {
  const raw  = crypto.randomBytes(40).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");

  await refreshTokenModel.create({
    user:      userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    userAgent: req.headers["user-agent"],
    ip:        req.ip,
  });

  return raw;
};

const setRefreshCookie  = (res, raw) => res.cookie("refreshToken", raw, REFRESH_COOKIE_OPTIONS);
const clearRefreshCookie = (res) =>
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    path:     REFRESH_COOKIE_PATH,
  });

// ── Controllers ───────────────────────────────────────────────────────────────

export const signIn = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await userModel.findOne({ email });
  if (!user) return next(new Error("Invalid login credentials", { cause: 400 }));

  if (user.blocked)
    return res.status(403).json({ success: false, message: "Account is blocked" });

  const isMatch = await user.comparePassword(password);
  if (!isMatch) return next(new Error("Invalid login credentials", { cause: 400 }));

  const accessToken = signAccessToken(user._id);
  const rawRefresh  = await createRefreshToken(user._id, req);
  setRefreshCookie(res, rawRefresh);

  return res.status(200).json({
    success: true,
    message: "Login successfully",
    data: {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      user: {
        id:       user._id,
        userName: user.userName,
        email:    user.email,
        role:     user.role,
        image:    user.image || null,
      },
    },
    errors: null,
  });
});

export const refreshToken = asyncHandler(async (req, res, next) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return next(new Error("Refresh token is required", { cause: 400 }));

  const hash        = crypto.createHash("sha256").update(rawToken).digest("hex");
  const storedToken = await refreshTokenModel.findOne({ tokenHash: hash });

  if (!storedToken) return next(new Error("Invalid or expired refresh token", { cause: 401 }));

  if (storedToken.expiresAt < new Date()) {
    await storedToken.deleteOne();
    clearRefreshCookie(res);
    return next(new Error("Refresh token expired. Please log in again.", { cause: 401 }));
  }

  const user = await userModel.findById(storedToken.user).select("_id role blocked");
  if (!user || user.blocked) {
    await storedToken.deleteOne();
    clearRefreshCookie(res);
    return next(new Error("User unavailable", { cause: 401 }));
  }

  await storedToken.deleteOne();
  const newAccessToken = signAccessToken(user._id);
  const newRawRefresh  = await createRefreshToken(user._id, req);
  setRefreshCookie(res, newRawRefresh);

  return res.status(200).json({
    success: true,
    message: "Access token refreshed",
    data:    { accessToken: newAccessToken, expiresIn: ACCESS_TOKEN_EXPIRY },
    errors:  null,
  });
});

export const logout = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (rawToken) {
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await refreshTokenModel.deleteOne({ tokenHash: hash });
  }
  clearRefreshCookie(res);
  return res.status(200).json({ success: true, message: "Logged out successfully", data: null, errors: null });
});

export const getMe = asyncHandler(async (req, res, next) => {
  const user = await userModel
    .findById(req.user._id)
    .select("-password -passwordResetToken -passwordResetExpiry");
  if (!user) return next(new Error("User not found", { cause: 404 }));

  return res.status(200).json({ success: true, message: "Profile retrieved", data: { user }, errors: null });
});

export const updateSelf = asyncHandler(async (req, res, next) => {
  const user = await userModel.findById(req.user._id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  const allowed = ["userName", "phone", "password"];
  for (const key of allowed) {
    if (req.body[key] != null) user[key] = req.body[key];
  }
  await user.save();

  await logModel.create({
    user:    req.user._id,
    action:  "UPDATE_SELF_PROFILE",
    details: {
      updatedFields:   allowed.filter((k) => req.body[k] != null && k !== "password"),
      passwordChanged: Boolean(req.body.password),
    },
  });

  const safe = user.toObject();
  delete safe.password;
  delete safe.passwordResetToken;
  delete safe.passwordResetExpiry;

  return res.status(200).json({ success: true, message: "Profile updated", data: { user: safe }, errors: null });
});

export const sendCode = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await userModel.findOne({ email }).select("_id email");
  // Respond identically whether email exists or not — prevents enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: "If this email exists, a reset code has been sent.",
      data:    null,
      errors:  null,
    });
  }

  const code     = nanoid(8);
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiry   = new Date(Date.now() + 60 * 60 * 1000);

  await sendEmail(
    email,
    "Password Reset Code",
    `<p>Your password reset code: <b>${code}</b></p>
     <p>This code expires in <strong>1 hour</strong>.</p>`,
  );

  await userModel.updateOne(
    { _id: user._id },
    { passwordResetToken: codeHash, passwordResetExpiry: expiry },
  );

  const token = jwt.sign({ id: user._id }, process.env.FORGOTPASSWORDTOKEN, {
    expiresIn: "1h",
  });

  return res.status(200).json({
    success: true,
    message: "If this email exists, a reset code has been sent.",
    data:    { token },
    errors:  null,
  });
});

export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { otp, email, newPassword } = req.body;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer "))
    return next(new Error("Authorization header required", { cause: 400 }));

  const rawToken = authHeader.slice(7).trim();

  // Phase 1 fix: wrap jwt.verify — throws JsonWebTokenError on bad/expired tokens.
  let decoded;
  try {
    decoded = jwt.verify(rawToken, process.env.FORGOTPASSWORDTOKEN);
  } catch {
    return next(new Error("Reset link is invalid or has expired", { cause: 400 }));
  }

  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  const user    = await userModel.findOne({ email, passwordResetToken: otpHash, _id: decoded.id });
  if (!user)                          return next(new Error("Invalid OTP or email",              { cause: 400 }));
  if (user.passwordResetExpiry < new Date()) return next(new Error("OTP has expired. Request a new one.", { cause: 400 }));

  user.password            = newPassword;
  user.passwordResetToken  = null;
  user.passwordResetExpiry = null;
  await user.save();

  return res.status(200).json({ success: true, message: "Password changed successfully", data: null, errors: null });
});

export const createUser = asyncHandler(async (req, res, next) => {
  const { userName, email, password, role } = req.body;

  const exists = await userModel.findOne({ email }).select("_id");
  if (exists) return res.status(409).json({ success: false, message: "Email already exists" });

  const savedUser = await userModel.create({ userName, email, password, role });

  await logModel.create({
    user:    req.user._id,
    action:  "CREATE_USER",
    details: { userId: savedUser._id, userName: savedUser.userName, email: savedUser.email, role: savedUser.role },
  });

  return res.status(201).json({ success: true, message: "User created successfully", data: { user_id: savedUser._id }, errors: null });
});

export const updateUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (req.body.blocked === true && id === req.user._id.toString()) {
    return next(new Error("You cannot block your own account", { cause: 400 }));
  }

  const user = await userModel.findById(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  const passwordChanged = Boolean(req.body.password);

  for (const key of ADMIN_UPDATABLE_USER_FIELDS) {
    if (req.body[key] != null) user[key] = req.body[key];
  }
  await user.save();

  await logModel.create({
    user: req.user._id,
    action: "UPDATE_USER",
    details: {
      userId: id,
      updatedFields: ADMIN_UPDATABLE_USER_FIELDS.filter(
        (k) => req.body[k] != null && k !== "password",
      ),
      passwordChanged,
    },
  });

  const safe = user.toObject();
  delete safe.password;
  delete safe.passwordResetToken;
  delete safe.passwordResetExpiry;

  return res
    .status(200)
    .json({
      success: true,
      message: "User updated successfully",
      data: { user: safe },
      errors: null,
    });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { role, blocked, page, size } = req.query;

  const query = {};
  if (role)                  query.role    = role;
  if (blocked !== undefined) query.blocked = blocked === "true";

  const { limit, skip } = pagination(page, size);
  const [users, totalCount] = await Promise.all([
    userModel
      .find(query)
      .select("-password -passwordResetToken -passwordResetExpiry")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip),
    userModel.countDocuments(query),
  ]);

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { totalCount, totalPages: Math.ceil(totalCount / limit), page: parseInt(page) || 1, users },
    errors: null,
  });
});

export const deleteUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (id === req.user._id.toString())
    return next(new Error("You cannot delete your own account", { cause: 400 }));

  const user = await userModel.findByIdAndDelete(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  await refreshTokenModel.deleteMany({ user: id });
  await logModel.create({
    user:    req.user._id,
    action:  "DELETE_USER",
    details: { userId: id, userName: user.userName, email: user.email, role: user.role },
  });

  return res.status(200).json({ success: true, message: "User deleted successfully", data: null, errors: null });
});

export const uploadUserImage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!req.file) return next(new Error("No image file provided", { cause: 400 }));

  const user = await userModel.findById(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  if (user.imagePublicId) {
    await deleteImage(user.imagePublicId).catch((e) =>
      console.warn("⚠️  Could not delete old Cloudinary image:", e.message),
    );
  }

  const result       = await uploadImage(req.file.buffer, "profiles");
  user.image         = result.secure_url;
  user.imagePublicId = result.public_id;
  await user.save();

  await logModel.create({
    user:    req.user._id,
    action:  "UPLOAD_USER_IMAGE",
    details: { targetUserId: id, cloudinaryPublicId: result.public_id },
  });

  return res.status(200).json({ success: true, message: "Image uploaded", data: { imageUrl: result.secure_url }, errors: null });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const deleted = await refreshTokenModel.deleteMany({ user: req.user._id });
  clearRefreshCookie(res);

  await logModel.create({
    user:    req.user._id,
    action:  "LOGOUT_ALL_SESSIONS",
    details: { sessionsRevoked: deleted.deletedCount },
  });

  return res.status(200).json({
    success: true,
    message: `Logged out from all devices. ${deleted.deletedCount} session(s) revoked.`,
    data:    { sessionsRevoked: deleted.deletedCount },
    errors:  null,
  });
});
