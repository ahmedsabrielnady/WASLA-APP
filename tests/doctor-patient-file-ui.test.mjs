import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
