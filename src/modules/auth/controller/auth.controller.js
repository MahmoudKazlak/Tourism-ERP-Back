import sendEmail from "../../../services/email.js";
import jwt from "jsonwebtoken";
import userModel from "../../../../DB/model/user.model.js";
import logModel from "../../../../DB/model/log.model.js";
import { nanoid } from "nanoid";
import { asyncHandler } from "../../../middleware/asyncHandler.js";

export const signIn = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await userModel.findOne({ email });
  if (!user) {
    return next(new Error("Invalid login credentials", { cause: 400 }));
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return next(new Error("Invalid login credentials", { cause: 400 }));
  }

  if (user.blocked) {
    return res.status(403).json({ message: "This account is blocked" });
  }

  const token = jwt.sign({ id: user._id }, process.env.SIGNINTOKEN, {
    expiresIn: "8h",
  });

  return res.status(200).json({
    success: true,
    message: "Login successfully",
    data: {
      token,
      user: {
        id: user._id,
        userName: user.userName,
        email: user.email,
        role: user.role,
      },
    },
    errors: null,
  });
});

export const sendCode = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await userModel.findOne({ email }).select("_id email");
  if (!user) {
    // Do not reveal whether the email exists (security best practice).
    return res.status(200).json({
      success: true,
      message: "If this email exists, a code has been sent.",
      data: null,
      errors: null,
    });
  }

  const code = nanoid();
  await sendEmail(
    email,
    "Forgot Password",
    `Your verification code: <b>${code}</b>`,
  );
  await userModel.updateOne({ _id: user._id }, { sendCode: code });

  const token = jwt.sign({ id: user._id }, process.env.FORGOTPASSWORDTOKEN, {
    expiresIn: "1h",
  });

  return res.status(200).json({
    success: true,
    message: "If this email exists, a code has been sent.",
    data: { token },
    errors: null,
  });
});

export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { otp, email, newPassword } = req.body;
  let { token } = req.headers;

  if (!token || !token.startsWith(process.env.BEARERKEY)) {
    return next(new Error("Invalid token", { cause: 400 }));
  }

  token = token.slice(process.env.BEARERKEY.length);
  const decoded = jwt.verify(token, process.env.FORGOTPASSWORDTOKEN);

  if (!otp || !decoded) {
    return next(new Error("Invalid request", { cause: 400 }));
  }

  // FIX: Use find() + save() instead of findOneAndUpdate() so the
  // userSchema.pre('save') hook handles hashing consistently.
  // Previously this path manually called bcrypt.hash(), creating a third
  // hashing path that ignored SALTROUND.
  const user = await userModel.findOne({
    email,
    sendCode: otp,
    _id: decoded.id,
  });

  if (!user) {
    return next(new Error("Invalid OTP or email", { cause: 400 }));
  }

  user.password = newPassword; // pre('save') will hash this
  user.sendCode = "dontTrust32";
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

  // userModel.create() triggers pre('save'), so password is hashed correctly.
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

  // Fields that must never be modified through this endpoint.
  const protectedFields = ["_id", "sendCode"];

  const user = await userModel.findById(id);
  if (!user) return next(new Error("User not found", { cause: 404 }));

  const passwordChanged = Boolean(req.body.password);

  // Apply every permitted field directly onto the document.
  // Because we use user.save() below, the pre('save') hook will hash the
  // password if it was modified — no manual bcrypt.hash() needed, and
  // SALTROUND from env is always respected.
  for (const [key, value] of Object.entries(req.body)) {
    if (!protectedFields.includes(key) && value != null) {
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
        (k) => !protectedFields.includes(k) && k !== "password",
      ),
      passwordChanged,
    },
  });

  // Return the document without sensitive fields.
  const safeUser = user.toObject();
  delete safeUser.password;
  delete safeUser.sendCode;

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
    .select("-password -sendCode")
    .sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    message: "Data retrieved successfully",
    data: { count: users.length, users },
    errors: null,
  });
});
