import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const main = read("../src/main.js");
const api = read("../src/supabase.js");
const provider = read("../src/provider.js");
const sql = read("../supabase/drafts/20261126000400_store_cart_and_merchant_response.sql");

test("market and food use a cart grouped per merchant with one checkout", () => {
  assert.match(main, /data-form="cart-add"/);
  assert.match(main, /data-form="cart-checkout"/);
  assert.match(main, /data-cart-merchant/);
  assert.match(main, /placeCartOrder\(lines, values\.address/);
  assert.match(api, /rpc\/place_cart_order/);
});

test("cart RPC is atomic, bounded and locks products in id order", () => {
  assert.match(sql, /order by 1 loop/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_n > 10/);
  assert.match(sql, /not m\.is_test/);
  assert.match(sql, /revoke execute on function public\.place_cart_order\(jsonb,text,text,text\) from public, anon/);
});

test("merchant accept or reject is limited to the assigned merchant's new store orders", () => {
  assert.match(provider, /data-action="store-respond"/);
  assert.match(api, /rpc\/merchant_respond_store_order/);
  assert.match(sql, /v_o\.provider_id is distinct from v_pid/);
  assert.match(sql, /v_o\.status <> 'new'/);
  assert.match(sql, /insert into public\.order_events/);
});

test("each section has its own cart and storage key, restored and re-validated against live products", () => {
  assert.match(main, /wasla\.cart\.v2:/);
  assert.match(main, /function restoreCarts/);
  assert.match(main, /carts: \{ market: \[\], food: \[\], supplies: \[\] \}/);
  assert.match(main, /\(p\.category \|\| "market"\) === category\)/);
  assert.match(main, /Math\.min\(Number\(entry\.qty\) \|\| 0, 20, Number\(product\.stock\)/);
  assert.match(main, /هذا المنتج ليس من هذا القسم/);
  assert.match(main, /data-form="cart-checkout" data-category="\$\{category\}"/);
  assert.doesNotMatch(main, /state\.cart\b(?!s)/);
});

test("medical supplies use the cart RPC but never share a cart with market or food", () => {
  assert.match(sql, /السلة لازم تكون من قسم واحد/);
  assert.match(sql, /count\(distinct pr\.category\)/);
  assert.match(sql, /category not in \('market','food','supplies'\)/);
  assert.match(main, /storePanel\("supplies", "الصحة", "مستلزمات طبية"/);
});

test("order status notifications say accepted or cancelled instead of a generic change", () => {
  assert.match(main, /function orderStatusNotificationText/);
  assert.match(main, /التاجر قبل طلبك/);
  assert.match(main, /orderStatusNotificationText\(order\)\) \|\| NOTIFICATION_TEXT\[n\.kind\]/);
});

test("orders page shows an overview of the pending carts per section without merging them", () => {
  assert.match(main, /function pendingCartsOverview/);
  assert.match(main, /CART_CATEGORIES\.filter\(\(category\) => cartLines\(category\)\.length\)/);
  assert.match(main, /\$\{pendingCartsOverview\(\)\}/);
  assert.match(main, /سلتي وطلباتي/);
});

test("the orders page does not render any section's product forms", () => {
  assert.doesNotMatch(main, /storeSection/);
  const ordersView = main.slice(main.indexOf("function ordersView()"), main.indexOf("function ordersView()") + 1800);
  assert.doesNotMatch(ordersView, /storePanel\(/);
});

test("the cart and orders nav entry leaves a section page", () => {
  assert.match(main, /if \(action === "orders" && state\.user\?\.id && state\.profile\?\.role === "customer"\) state\.view = "orders";/);
});
