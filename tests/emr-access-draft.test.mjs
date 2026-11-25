import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002700_emr_access_log.sql", import.meta.url), "utf8");

test("audit log is insert-by-rpc only, readable by the patient and staff, with no content columns", () => {
  assert.match(sql, /revoke all on public\.emr_access_log from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.emr_access_log to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*emr_access_log/);
  const cols = sql.match(/create table if not exists public\.emr_access_log \(([\s\S]*?)\n\);/)[1];
  assert.doesNotMatch(cols, /\bnote\b|content|body|detail/);
});

test("the rpc needs an approved doctor and a care relationship, and logs before returning data", () => {
  assert.match(sql, /not an approved doctor/);
  assert.match(sql, /no care relationship with this patient/);
  assert.ok(sql.indexOf("insert into public.emr_access_log") < sql.indexOf("select coalesce(jsonb_agg(jsonb_build_object('id', o.id"));
  assert.match(sql, /revoke all on function public\.doctor_open_patient_file\(uuid\) from public, anon/);
});
