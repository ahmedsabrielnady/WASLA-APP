import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("merchant order cards show the product and quantity", () => {
  const provider = read("../src/provider.js");
  const api = read("../src/supabase.js");
  assert.match(provider, /provider-order-product/);
  assert.match(provider, /order\.product_name/);
  assert.match(api, /product_id,product_category/);
  assert.match(api, /rest\/v1\/products\?.*id,name/s);
});
