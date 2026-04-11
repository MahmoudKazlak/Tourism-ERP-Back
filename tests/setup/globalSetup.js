/**
 * Jest globalSetup — runs once before all test suites.
 *
 * Starts a real (in-process) MongoDB instance via mongodb-memory-server,
 * writes the connection URI into process.env so every test file can reach it,
 * and serialises the server state into globalThis for globalTeardown to use.
 *
 * WHY mongodb-memory-server:
 *   - Fully isolated — tests never touch a real database.
 *   - Torn down cleanly after the run — no leftover data.
 *   - Supports replica sets if needed (for Mongoose transactions).
 */
// tests/setup/globalSetup.js
import { MongoMemoryReplSet } from "mongodb-memory-server";

export default async function globalSetup() {
  // ReplSet instead of single instance — enables Mongoose transactions.
  const mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, // single-node replica set is enough
  });

  const uri = mongod.getUri();
  process.env.TEST_MONGO_URI = uri;
  process.env.DBURI = uri;
  globalThis.__MONGOD__ = mongod;

  console.log(`\n🧪 Test MongoDB (ReplicaSet) started at: ${uri}\n`);
}