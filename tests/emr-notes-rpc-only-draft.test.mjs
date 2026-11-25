import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002800_doctor_notes_rpc_only.sql", import.meta.url), "utf8");

test("draft 2800 drops only the doctor's direct select on medical_notes and states audit coverage", () => {
  assert.match(sql, /drop policy if exists notes_doctor_read on public\.medical_notes/);
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.doesNotMatch(code, /notes_patient_read|notes_doctor_write/);
  assert.equal((code.match(/;/g) || []).length, 1);
  assert.match(sql, /Doctor reads of ORDERS .* are NOT audited/);
  assert.match(sql, /No staff select policy exists on medical_notes/);
});
