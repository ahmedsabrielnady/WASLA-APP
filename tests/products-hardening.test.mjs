import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const drafts = new URL("../supabase/drafts/", import.meta.url);
const read = async (part) => readFile(new URL((await readdir(drafts)).find((f) => f.includes(part)), drafts), "utf8");

test("draft 1400 bounds products, closes direct insert and aligns visibility with purchasing", async () => {
  const sql = await read("products_bounds_and_visibility");
  assert.match(sql, /price_egp between 1 and 100000 and stock between 0 and 10000/);
  assert.match(sql, /revoke insert on public\.products from authenticated/);
  assert.match(sql, /m\.kind = 'merchant' and m\.approved and m\.active and not m\.is_test/);
  assert.match(sql, /products_authenticated_read[\s\S]*merchant_is_sellable\(merchant_id\)/);
  assert.match(sql, /products_public_read[\s\S]*merchant_is_sellable\(merchant_id\)/);
});

test("the create RPC and the purchase RPC use the same merchant eligibility", async () => {
  const add = await read("merchant_add_product");
  const buy = await read("product_order_merchant_checks");
  for (const sql of [add, buy]) assert.match(sql, /kind = 'merchant' and (p|m)\.approved and (p|m)\.active and not (p|m)\.is_test/);
  assert.match(add, /p_category not in \('market','food','supplies'\)/);
});
