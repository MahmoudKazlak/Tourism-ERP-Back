/**
 * Jest globalTeardown — runs once after all test suites complete.
 * Stops the in-memory MongoDB server created in globalSetup.
 */
export default async function globalTeardown() {
  if (globalThis.__MONGOD__) {
    await globalThis.__MONGOD__.stop();
    console.log("\n🧹 Test MongoDB stopped.\n");
  }
}
