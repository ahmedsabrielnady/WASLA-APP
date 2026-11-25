import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const drafts = new URL("../supabase/drafts/", import.meta.url);

test("draft 1200 adds supplies to both category checks and keeps the order guards", async () => {
  const name = (await readdir(drafts)).find((f) => f.includes("products_supplies_category"));
  assert.ok(name, "draft exists in supabase/drafts");
  const sql = await readFile(new URL(name, drafts), "utf8");
  assert.match(sql, /products_category_check check \(category in \('market','food','supplies'\)\)/);
  assert.match(sql, /orders_product_category_check check \(product_category is null or product_category in \('market','food','supplies'\)\)/);
  assert.match(sql, /v_p\.category not in \('market','food','supplies'\)/);
  assert.match(sql, /m\.kind = 'merchant' and m\.approved and m\.active and not m\.is_test/);
  assert.match(sql, /m\.user_id = v_uid/);
  assert.doesNotMatch(sql, /customer role|role = 'customer'/i);
});

test("the store section renders a separate supplies panel through the same order form", async () => {
  const js = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(js, /storePanel\("supplies", "الصحة", "مستلزمات طبية"/);
  assert.match(js, /id="\$\{category === "food" \? "food" : category === "supplies" \? "supplies" : "store"\}"/);
});
