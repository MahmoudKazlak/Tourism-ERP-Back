/**
 * One-time migration: converts the old named-array schema
 * (accommodations, carRentals, carWithDriver) to the unified
 * services array schema.
 *
 * Usage:
 *   node scripts/migrateServices.js
 *
 * FIX Bug 9: the skip condition now correctly identifies already-migrated
 * bookings by checking for the ABSENCE of old arrays, not just the presence
 * of a non-empty services array. A booking with services:[] (migrated,
 * no services) was previously not skipped and would be processed again.
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
  // Bug 9 fix: a booking is already on the new schema when it has NO old
  // named arrays. The previous check (services.length > 0) would re-process
  // bookings that were migrated but had zero services.
  const hasOldArrays =
    (Array.isArray(doc.accommodations) && doc.accommodations.length > 0) ||
    (Array.isArray(doc.carRentals) && doc.carRentals.length > 0) ||
    (Array.isArray(doc.carWithDriver) && doc.carWithDriver.length > 0);

  const alreadyMigrated =
    Array.isArray(doc.services) &&
    (doc.services.length === 0 || doc.services[0]?.serviceType) &&
    !hasOldArrays;

  if (alreadyMigrated) {
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
