/**
 * One-time migration: converts the old named-array schema
 * (accommodations, carRentals, carWithDriver) to the unified
 * services array schema.
 *
 * Usage:
 *   node scripts/migrateServices.js
 *
 * Safe to run multiple times — skips bookings that already have
 * the new schema (detected by the presence of booking.services
 * with serviceType fields).
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: "./config/.env" });

await mongoose.connect(process.env.DBURI);
console.log("✅ Connected to MongoDB");

const Booking = mongoose.connection.collection("bookings");
const cursor = Booking.find({});

let migrated = 0;
let skipped = 0;
let errors = 0;

for await (const doc of cursor) {
  // Skip if already migrated (has a services array with serviceType)
  if (
    Array.isArray(doc.services) &&
    doc.services.length > 0 &&
    doc.services[0].serviceType
  ) {
    skipped++;
    continue;
  }

  const services = [];

  for (const item of doc.accommodations || []) {
    const {
      hotel,
      checkIn,
      checkOut,
      duration,
      room,
      roomType,
      board,
      buy,
      sell,
      profit,
      serviceNumber,
      _id,
    } = item;
    services.push({
      _id: _id || new mongoose.Types.ObjectId(),
      serviceType: "accommodation",
      provider: hotel,
      serviceNumber,
      buy: buy || 0,
      sell: sell || 0,
      profit: profit || 0,
      duration,
      details: { checkIn, checkOut, room, roomType, board },
    });
  }

  for (const item of doc.carRentals || []) {
    const {
      provider,
      brand,
      pickUp,
      dropOff,
      buy,
      sell,
      profit,
      serviceNumber,
      _id,
    } = item;
    services.push({
      _id: _id || new mongoose.Types.ObjectId(),
      serviceType: "carRental",
      provider,
      serviceNumber,
      buy: buy || 0,
      sell: sell || 0,
      profit: profit || 0,
      details: { brand, pickUp, dropOff },
    });
  }

  for (const item of doc.carWithDriver || []) {
    const {
      provider,
      driverName,
      brand,
      buy,
      sell,
      profit,
      serviceNumber,
      _id,
    } = item;
    services.push({
      _id: _id || new mongoose.Types.ObjectId(),
      serviceType: "carWithDriver",
      provider,
      serviceNumber,
      buy: buy || 0,
      sell: sell || 0,
      profit: profit || 0,
      details: { driverName, brand },
    });
  }

  try {
    await Booking.updateOne(
      { _id: doc._id },
      {
        $set: { services },
        $unset: { accommodations: "", carRentals: "", carWithDriver: "" },
      },
    );
    migrated++;
    if (migrated % 100 === 0) console.log(`  Migrated ${migrated} bookings...`);
  } catch (err) {
    console.error(`❌ Failed to migrate booking ${doc._id}: ${err.message}`);
    errors++;
  }
}

console.log(`\n✅ Migration complete.`);
console.log(`   Migrated : ${migrated}`);
console.log(`   Skipped  : ${skipped} (already on new schema)`);
console.log(`   Errors   : ${errors}`);

await mongoose.disconnect();
