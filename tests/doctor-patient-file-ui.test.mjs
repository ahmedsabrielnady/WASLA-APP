import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientFileDeniedMessage, pageSlice, FILE_PAGE_SIZE } from "../src/domain.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("doctor reads notes through the audited rpc, not the table list, and the file is cleared on logout and reload", () => {
  assert.match(api, /rpc\/doctor_open_patient_file/);
  assert.match(main, /data-action="open-patient-file"/);
  assert.match(main, /فتح الملف بيتسجل في سجل الوصول/);
  assert.ok((main.match(/state\.doctorFile = null/g) || []).length >= 4);
  const doctorBlock = main.slice(main.indexOf("function medicalNotesSection"), main.indexOf('id="my-notes"'));
  assert.doesNotMatch(doctorBlock, /\$\{list \?/);
});

test("patient labels are opaque ids, not names", () => {
  assert.match(main, /ملف المريض #\$\{escapeHTML\(String\(f\.patientId\)\.slice\(0, 4\)\.toUpperCase\(\)\)\}/);
});

test("a refused patient file shows an Arabic message and other errors pass through", () => {
  assert.equal(patientFileDeniedMessage("no care relationship with this patient"), "مفيش حالة بينك وبين المريض ده، فمش هتقدر تفتح ملفه.");
  assert.equal(patientFileDeniedMessage("يلزم تسجيل الدخول"), "يلزم تسجيل الدخول");
  assert.equal(patientFileDeniedMessage(""), "تعذر فتح الملف.");
  assert.match(api, /throw new Error\(patientFileDeniedMessage\(error\?\.message\)\)/);
});

test("long patient file lists are paged and the remainder is reachable", () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i }));
  assert.equal(FILE_PAGE_SIZE, 20);
  let p = pageSlice(rows, FILE_PAGE_SIZE);
  assert.deepEqual([p.items.length, p.remaining], [20, 25]);
  p = pageSlice(rows, FILE_PAGE_SIZE * 3);
  assert.deepEqual([p.items.length, p.remaining], [45, 0]);
  assert.deepEqual(pageSlice(undefined), { items: [], remaining: 0 });
  assert.deepEqual(pageSlice([], 20), { items: [], remaining: 0 });
  assert.match(main, /data-action="more-patient-file"/);
  assert.match(main, /action === "more-patient-file"/);
  assert.match(main, /limit: FILE_PAGE_SIZE/);
});
