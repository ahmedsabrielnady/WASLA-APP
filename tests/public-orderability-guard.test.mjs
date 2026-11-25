import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSql = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("public pilot order RPC rejects catalogue items not enabled for public ordering", () => {
  const sql = readSql("../supabase/live-patches/20261123_public_pilot_restrict_orderable_sectors.sql");
  assert.match(sql, /and\s+public_orderable\s*=\s*true/i);
  assert.match(sql, /and\s+active\s*=\s*true/i);
  assert.match(sql, /p_sector\s+not in\s*\('maintenance','car'\)/i);
});

test("provider coverage sync only enables services with an approved active non-test provider", () => {
  const sql = readSql("../supabase/live-patches/20261123_provider_service_coverage_and_assignment_guard.sql");
  assert.match(sql, /p\.approved\s*=\s*true/i);
  assert.match(sql, /p\.active\s*=\s*true/i);
  assert.match(sql, /p\.is_test\s*=\s*false/i);
  assert.match(sql, /c\.active\s*=\s*true/i);
});
