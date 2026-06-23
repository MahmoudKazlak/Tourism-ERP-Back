/**
 * excel.builder.js
 * ExcelJS streaming workbook factory and sheet helpers.
 *
 * Memory strategy: WorkbookWriter streams each committed row directly to the
 * HTTP response and releases its memory immediately. The server heap stays
 * roughly constant regardless of how many rows are written.
 *
 * Column widths are set at sheet-creation time because the streaming writer
 * cannot rewind to resize columns after data has been flushed.
 */
import ExcelJS from "exceljs";

const HEADER_BG    = "FF0D3D35"; // deep teal — Kazlak brand
const HEADER_FG    = "FFFFFFFF";
const SECTION_BG   = "FF1A5C52"; // slightly lighter teal for summary sections
const ALT_ROW_BG   = "FFF0F7F6"; // faint mint for alternating rows

export const createStreamingWorkbook = (res, filename) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  return new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: true,
  });
};

export const addStyledSheet = (workbook, sheetName, columns) => {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
  });

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key:    col.key,
    width:  col.width ?? 18,
    numFmt: col.numFmt ?? resolveNumFmt(col.type),
    style: {
      alignment: {
        vertical:   "middle",
        horizontal: ["currency","number","percent"].includes(col.type) ? "right" : "left",
        wrapText:   false,
      },
    },
  }));

  // Style the header row that ExcelJS already wrote via sheet.columns
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: HEADER_FG }, size: 10, name: "Calibri" };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border    = { bottom: { style: "thin", color: { argb: "FF34B09A" } } };
  });
  // CRITICAL: commit the header before adding data rows
  headerRow.commit();
  return sheet;
};

/**
 * Adds one data row and commits it immediately.
 * `row.commit()` flushes to the network buffer and frees memory.
 * Omitting this causes all rows to accumulate in RAM.
 */
export const addDataRow = (sheet, data, rowIndex) => {
  const row  = sheet.addRow(data);
  row.height = 18;
  if (rowIndex % 2 === 0) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW_BG } };
    });
  }
  row.commit();
};

export const addSummarySheet = (workbook, rows) => {
  const sheet = workbook.addWorksheet("📊 Summary", { views: [{ state: "frozen", ySplit: 2 }] });
  sheet.columns = [{ key: "label", width: 40 }, { key: "value", width: 22 }];

  // Title
  const title = sheet.addRow(["HayfaTur — Full Data Export"]);
  title.height = 28;
  const tc = title.getCell(1);
  tc.font  = { bold: true, size: 14, color: { argb: HEADER_FG }, name: "Calibri" };
  tc.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  tc.alignment = { vertical: "middle" };
  sheet.mergeCells("A1:B1");
  title.commit();

  // Generated timestamp
  const meta = sheet.addRow(["Generated", new Date().toLocaleString("en-GB")]);
  ["A2","B2"].forEach((r) => { const c = sheet.getCell(r); c.font = { italic: true, color: { argb: "FF666666" } }; });
  meta.commit();
  sheet.addRow([]).commit(); // spacer

  let i = 0;
  for (const [label, value, isSection] of rows) {
    const row = sheet.addRow([label, value]);
    row.height = 20;
    if (isSection) {
      row.getCell(1).font  = { bold: true, color: { argb: HEADER_FG }, size: 10 };
      row.getCell(1).fill  = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
      row.getCell(2).fill  = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
      sheet.mergeCells(`A${row.number}:B${row.number}`);
    } else {
      if (i % 2 === 0) row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW_BG } }; });
      row.getCell(2).alignment = { horizontal: "right" };
    }
    row.commit();
    i++;
  }
  sheet.commit();
};

const resolveNumFmt = (type) => {
  switch (type) {
    case "currency": return '"$"#,##0.00';
    case "date":     return "dd/mm/yyyy";
    case "percent":  return "0.0%";
    case "number":   return "#,##0";
    default:         return undefined;
  }
};
