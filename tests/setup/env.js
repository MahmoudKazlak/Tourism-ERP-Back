/**
 * Injected via jest.config `setupFiles`.
 * Runs BEFORE any module import, so every env-check in app.js, auth.js, etc.
 * sees these values from the very first import.
 *
 * The DBURI is overwritten per-suite by globalSetup once the memory server
 * has started and written its URI to process.env.TEST_MONGO_URI.
 */

// Tokens — safe dummy values, never real secrets.
process.env.SIGNINTOKEN = "test_access_secret_32chars_minimum_ok";
process.env.FORGOTPASSWORDTOKEN = "test_reset_secret_32chars_minimum_ok";
process.env.BEARERKEY = "Bearer "; // kept for any legacy references
process.env.SALTROUND = "1"; // bcrypt rounds=1 → fast hashing in tests

// Email — mocked at module level, values never used for real sends.
process.env.SENDEREMAIL = "test@example.com";
process.env.SENDEREMAILPASSWORD = "test_password";

// Cloudinary — mocked at module level, values never sent to Cloudinary.
process.env.CLOUDINARY_CLOUD_NAME = "test_cloud";
process.env.CLOUDINARY_API_KEY = "test_api_key";
process.env.CLOUDINARY_API_SECRET = "test_api_secret";

// Logging — short retention for tests.
process.env.LOG_RETENTION_DAYS = "1";

// Access token lifetime.
process.env.ACCESS_TOKEN_EXPIRY = "1h";

// DBURI is set by globalSetup after the in-memory server starts.
// This placeholder prevents app.js from exiting during module loading
// in cases where globalSetup has not yet run (e.g. unit tests that
// don't boot the full app).
process.env.DBURI = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1/test";
