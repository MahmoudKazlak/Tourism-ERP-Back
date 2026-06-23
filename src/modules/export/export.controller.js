/**
 * export.controller.js
 * Thin HTTP handler — no business logic, just translates req/res into a
 * service call and handles mid-stream error edge cases.
 */
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { generateFullExport } from "./export.service.js";

export const downloadFullExport = asyncHandler(async (req, res, next) => {
  const date     = new Date().toISOString().split("T")[0];
  const filename = `hayfa-tur-export-${date}.xlsx`;

  try {
    await generateFullExport(res, filename);
  } catch (err) {
    // Headers not yet sent → let the global error handler respond normally
    if (!res.headersSent) return next(err);

    // Streaming already started → destroy the socket so the browser gets
    // an error instead of silently saving a corrupt file
    console.error("❌ Export stream failed mid-flight:", err.message);
    res.destroy(err);
  }
});
