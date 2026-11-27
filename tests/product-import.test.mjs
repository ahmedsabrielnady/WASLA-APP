import test from "node:test";
import assert from "node:assert/strict";
import { roundPrices, parseCsv, rowsFromCsv, templateCsv, chunkRows, mergeImportResults, arabicDigitsToLatin } from "../src/product-import.js";

test("template parses back with its own headers", () => {
  const { rows, error } = rowsFromCsv(templateCsv());
  assert.equal(error, "");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "لبن كامل الدسم 1 لتر");
  assert.equal(rows[0].price, "38");
  assert.equal(rows[0].barcode, "6221000000011");
});
test("semicolon delimiter, quotes and Arabic digits", () => {
  const { rows } = rowsFromCsv('الاسم;السعر;المخزون\r\n"شاي ""ليبتون"" 100";١٢٠;٥\r\n');
  assert.equal(rows[0].name, 'شاي "ليبتون" 100');
  assert.equal(rows[0].price, "120");
  assert.equal(rows[0].stock, "5");
});
test("missing required column and empty file are reported", () => {
  assert.match(rowsFromCsv("الاسم,السعر\r\nx,5\r\n").error, /المخزون/);
  assert.match(rowsFromCsv("").error, /فاضي/);
});
test("chunking and merge map rows back to sheet rows", () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ name: String(i) }));
  const chunks = chunkRows(rows, 1000);
  assert.deepEqual(chunks.map((c) => c.length), [1000, 1000, 500]);
  const merged = mergeImportResults([{ total: 1000, new: 999, update: 0, errors: 1, warnings: 0, rows: [{ n: 5, status: "error", msg: "x" }] }, { total: 1000, new: 1000, update: 0, errors: 0, warnings: 0, rows: [] }], 1000);
  assert.equal(merged.rows[0].sheetRow, 6);
  assert.equal(merged.errors, 1);
});
test("digits", () => assert.equal(arabicDigitsToLatin("٣٫٥"), "3.5"));
test("roundPrices rounds piasters only", () => {
  assert.deepEqual(roundPrices([{ price: "12.5" }, { price: "12.4" }, { price: "30" }, { price: "abc" }, { price: "" }]).map((r) => r.price), ["13", "12", "30", "abc", ""]);
});
