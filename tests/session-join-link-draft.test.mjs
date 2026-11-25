import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002200_session_join_link.sql", import.meta.url), "utf8");

test("join link is a separate RLS table, written only through the teacher RPC", () => {
  assert.match(sql, /create table if not exists public\.session_join_links/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.session_join_links from anon, authenticated;\s*\ngrant select on public\.session_join_links to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*session_join_links/i);
  assert.match(sql, /e\.status='booked' and s\.status='open'/);
});

test("RPC accepts only https URLs without credentials or spaces, and only for the owner's open online session", () => {
  assert.match(sql, /\^https:\/\/\[\^\/@\[:space:\]\]\+/);
  assert.match(sql, /v_s\.mode<>'online' or v_s\.status<>'open'/);
  assert.match(sql, /p\.user_id=v_uid and p\.kind='teacher' and p\.approved/);
  assert.doesNotMatch(sql, /starts_at\s*-\s*interval/);
});
