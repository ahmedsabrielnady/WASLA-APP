import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/live-patches/20261125_validate_order_coordinates.sql", import.meta.url),
  "utf8",
);

test("order RPC rejects incomplete coordinate pairs", () => {
  assert.match(sql, /\(p_lat\s+is\s+null\)\s*<>\s*\(p_lng\s+is\s+null\)/i);
});

test("order RPC enforces latitude and longitude bounds", () => {
  assert.match(sql, /p_lat\s*<\s*-90\s+or\s+p_lat\s*>\s*90\s+or\s+p_lng\s*<\s*-180\s+or\s+p_lng\s*>\s*180/i);
});

test("order RPC retains optional location behavior and authenticated caller check", () => {
  assert.match(sql, /v_uid\s+uuid\s*:=\s*\(select\s+auth\.uid\(\)\)/i);
  assert.match(sql, /if\s+v_uid\s+is\s+null/i);
  assert.match(sql, /p_lat\s*,\s*p_lng/i);
  assert.match(sql, /set\s+search_path\s*=\s*''/i);
});
