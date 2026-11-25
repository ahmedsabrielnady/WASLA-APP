import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002600_lab_requests.sql", import.meta.url), "utf8");

test("lab_requests is RLS-protected with select-only grants and no anon access", () => {
  assert.match(sql, /alter table public\.lab_requests enable row level security/);
  assert.match(sql, /revoke all on public\.lab_requests from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.lab_requests to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*lab_requests/);
});

test("price is a snapshot, a result needs the result_ready status, and rpcs are not callable by anon", () => {
  assert.match(sql, /price_egp int not null/);
  assert.match(sql, /check \(\(status = 'result_ready'\) = \(result_text is not null\)\)/);
  assert.match(sql, /revoke all on function public\.request_lab_test\(uuid\)[^;]*from public, anon/);
});

test("notification rows carry kind and reference id only", () => {
  const inserts = sql.match(/insert into public\.notifications\([^)]*\)/g) || [];
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0], "insert into public.notifications(user_id, kind, ref_id)");
  assert.match(sql, /'lab_status','lab_result_ready'/);
});
