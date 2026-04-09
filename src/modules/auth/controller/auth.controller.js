import bcrypt from "bcrypt";
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
    // لا نكشف إذا الإيميل موجود أو لا (security best practice)
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

  token = token.split(process.env.BEARERKEY)[1];
  const decoded = jwt.verify(token, process.env.FORGOTPASSWORDTOKEN);

  if (!otp || !decoded) {
    return next(new Error("Invalid request", { cause: 400 }));
  }

  const hash = await bcrypt.hash(newPassword, parseInt(process.env.SALTROUND));

  const user = await userModel.findOneAndUpdate(
    { email, sendCode: otp, _id: decoded.id },
    { password: hash, sendCode: "dontTrust32" },
  );

  if (!user) {
    return next(new Error("Invalid OTP or email", { cause: 400 }));
  }

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

  // FIX: لا نحفظ كلمة المرور في الـ log
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

  // الحقول المحمية — لا يمكن تعديلها من هنا
  const protectedFields = ["_id", "password", "sendCode"];
  const update = {};

  for (const key of Object.keys(req.body)) {
    if (!protectedFields.includes(key) && req.body[key] != null) {
      update[key] = req.body[key];
    }
  }

  // إذا بدهم يغيروا الباسورد ليش ما بيستخدموا forgotPassword؟
  // هون بنسمح فقط للـ admin يعدل عليها بشكل صريح
  if (req.body.password) {
    update.password = await bcrypt.hash(req.body.password, 10);
  }

  const user = await userModel
    .findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
    .select("-password -sendCode");

  // FIX: رسالة الخطأ كانت "fail to register"
  if (!user) return next(new Error("User not found", { cause: 404 }));

  // FIX: لا نحفظ كلمة المرور في الـ log
  await logModel.create({
    user: req.user._id,
    action: "UPDATE_USER",
    details: {
      userId: id,
      updatedFields: Object.keys(req.body).filter((k) => k !== "password"),
      passwordChanged: !!req.body.password,
    },
  });

  return res.status(200).json({
    success: true,
    message: "User updated successfully",
    data: { user },
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
