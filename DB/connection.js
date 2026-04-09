import mongoose from "mongoose";
import { seedAdmin } from "./adminSeed.js";

const connectDB = async () => {
  return await mongoose
    .connect(process.env.DBURI)
    .then(async (res) => {
      console.log("connectDb");
      await seedAdmin();
    })
    .catch((err) => {
      console.log("faild to connect", err);
    });
};

export default connectDB;
