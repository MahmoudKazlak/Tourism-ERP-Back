export default {
  testEnvironment: "node",
  transform: {},
  injectGlobals: false, // ← add this line
  setupFiles: ["./tests/setup/env.js"],
  globalSetup: "./tests/setup/globalSetup.js",
  globalTeardown: "./tests/setup/globalTeardown.js",
  testMatch: [
    "**/tests/unit/**/*.test.js",
    "**/tests/integration/**/*.test.js",
  ],
  verbose: true,
  testTimeout: 30000,
  collectCoverageFrom: [
    "src/services/bookingService.js",
    "src/modules/booking/controller/booking.controller.js",
    "src/modules/payment/controller/payment.controller.js",
    "DB/model/booking.model.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
};
