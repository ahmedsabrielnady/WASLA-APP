import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002500_notification_course_note.sql", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("draft 2500 adds doctor_note and course_changed with kind and reference id only", () => {
  assert.match(sql, /'doctor_note','course_changed'/);
  const inserts = sql.match(/insert into public\.notifications\([^)]*\)/g) || [];
  assert.equal(inserts.length, 2);
  for (const i of inserts) assert.equal(i, "insert into public.notifications(user_id, kind, ref_id)");
  assert.match(sql, /revoke all on function public\.notify_doctor_note\(\)/);
  assert.match(sql, /revoke all on function public\.notify_course_changed\(\)/);
});

test("lab price change is not built and the draft says why", () => {
  assert.match(sql, /Lab and radiology price changes are NOT built/);
  assert.doesNotMatch(sql, /lab_tests/);
});

test("page texts for the new kinds carry no health or price detail", () => {
  const t = main.match(/doctor_note: "([^"]+)"/)[1] + main.match(/course_changed: "([^"]+)"/)[1];
  assert.doesNotMatch(t, /سعر|جنيه|تشخيص|علاج|مرض|دواء/);
  assert.match(main, /course_changed: "course"/);
  assert.match(main, /id="course-\$\{escapeHTML\(item\.id\)\}"/);
});
