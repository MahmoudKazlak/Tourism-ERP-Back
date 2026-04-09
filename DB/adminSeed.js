import logModel from "./model/log.model.js";
import userModel from "./model/user.model.js";

export const seedAdmin = async () => {
  try {
    const adminExists = await userModel.findOne({ role: "admin" });

    if (!adminExists) {
      console.log("🚀 No admin found. Creating initial admin account...");

      const initialPassword = "Admin@123";

      const user = await userModel.create({
        userName: "SuperAdmin",
        email: "admin@system.com",
        password: initialPassword,
        role: "admin",
      });

      // FIX: لا نحفظ كلمة المرور في الـ log
      await logModel.create({
        user: user._id,
        action: "ADMIN_SEED",
        details: { userId: user._id, userName: user.userName },
      });

      console.log("✅ Initial Admin created: admin@system.com / Admin@123");
      console.log("⚠️  Change the password immediately after first login!");
    }
  } catch (error) {
    console.error("❌ Error seeding admin:", error);
  }
};
