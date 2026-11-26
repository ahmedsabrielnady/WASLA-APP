import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => readFileSync(new URL(`../supabase/drafts/${n}`, import.meta.url), "utf8");

test("order locations core draft does not depend on delivery_requests", () => {
  const a = read("20261126000000a_order_locations_core.sql");
  const code = a.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/delivery_request/i.test(code));
  for (const fn of ["save_order_location", "provider_get_order_location", "purge_expired_locations", "orders_strip_coordinates"]) {
    assert.ok(code.includes(fn), fn);
  }
  assert.match(code, /to_regprocedure\('public\.set_order_location/);
});

test("delivery locations draft is separate and needs delivery_requests", () => {
  const b = read("20261126000000b_delivery_locations.sql");
  assert.match(b, /references public\.delivery_requests/);
  assert.match(b, /save_delivery_locations/);
  assert.match(b, /courier_get_delivery_locations/);
  assert.match(read("20261126000000_order_locations.sql"), /^-- SUPERSEDED/);
});
