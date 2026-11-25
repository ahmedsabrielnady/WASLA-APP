import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/live-patches/20261125_fix_profiles_update_policy_recursion.sql", import.meta.url),
  "utf8",
);

test("profiles update policy uses a private, pinned SECURITY DEFINER role helper", () => {
  assert.match(sql, /create schema if not exists private/i);
  assert.match(
    sql,
    /create or replace function private\.current_profile_role\(\)[\s\S]*?security definer[\s\S]*?set search_path\s*=\s*''/i,
  );
  assert.match(
    sql,
    /revoke all on function private\.current_profile_role\(\) from public, anon, authenticated/i,
  );
  assert.match(sql, /grant usage on schema private to authenticated/i);
  assert.match(
    sql,
    /grant execute on function private\.current_profile_role\(\) to authenticated/i,
  );
  assert.match(
    sql,
    /with check\s*\([\s\S]*?id\s*=\s*\(select auth\.uid\(\)\)[\s\S]*?role\s*=\s*\(select private\.current_profile_role\(\)\)/i,
  );
});

test("profiles policy patch does not grant anon access or modify application rows", () => {
  assert.doesNotMatch(sql, /grant\s+.*\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\s+into?\s+public\./i);
});
