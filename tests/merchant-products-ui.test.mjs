import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function mockFetch(reply = [{ id: 1 }]) {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url: String(url), method: o.method || "GET", body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify(reply), { status: 200 }); };
  return calls;
}
const good = { name: "كمامات", category: "supplies", price: 40, stock: 5 };

test("saveProduct validates locally before any request", async () => {
  const calls = mockFetch();
  for (const bad of [{ name: "x" }, { category: "weapons" }, { price: 0 }, { price: 100001 }, { price: 1.5 }, { stock: -1 }, { stock: 10001 }, { stock: 1.2 }]) {
    await assert.rejects(dataApi.saveProduct({ ...good, ...bad }));
  }
  assert.equal(calls.length, 0);
  await dataApi.saveProduct(good);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/merchant_add_product$/);
  assert.deepEqual(calls[0].body, { p_name: "كمامات", p_category: "supplies", p_price: 40, p_stock: 5 });
});

test("saveProduct and updateProduct fail closed when no row comes back (RLS no-op)", async () => {
  mockFetch([]);
  await assert.rejects(dataApi.saveProduct(good));
  await assert.rejects(dataApi.updateProduct(3, { stock: 2 }));
  await assert.rejects(dataApi.updateProduct(3, { active: false }));
});

test("updateProduct sends only the validated fields for one id", async () => {
  const calls = mockFetch();
  await assert.rejects(dataApi.updateProduct("abc", { stock: 1 }));
  await assert.rejects(dataApi.updateProduct(3, { stock: -1 }));
  await assert.rejects(dataApi.updateProduct(3, {}));
  assert.equal(calls.length, 0);
  await dataApi.updateProduct(3, { stock: "7", active: true });
  assert.match(calls[0].url, /products\?id=eq\.3$/);
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(calls[0].body, { active: true, stock: 7 });
});

test("merchant product section is shown only to the merchant role and wired to the forms", () => {
  assert.match(main, /state\.profile\?\.role !== "merchant"\) return ""/);
  for (const f of ["product-add", "product-stock"]) assert.match(main, new RegExp(`form\\.dataset\\.form === "${f}"`));
  assert.match(main, /action === "toggle-product"/);
});
