import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function mockFetch(reply = [{ out_order_id: "x" }]) {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url: String(url), method: o.method || "GET", body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify(reply), { status: 200 }); };
  return calls;
}
const good = { itemId: 15, address: "عنوان اختبار طويل 9", notes: "x", consent: true, terms: true };

test("requestNursingVisit needs terms, health consent, item and address before any request", async () => {
  const calls = mockFetch();
  for (const bad of [{ consent: false }, { consent: undefined }, { terms: false }, { itemId: "x" }, { address: "قصير" }]) {
    await assert.rejects(dataApi.requestNursingVisit({ ...good, ...bad }));
  }
  assert.equal(calls.length, 0);
});

test("requestNursingVisit records consent first, then calls only the nursing RPC", async () => {
  const calls = mockFetch();
  await dataApi.requestNursingVisit(good);
  const urls = calls.map((c) => c.url.replace(/^.*\/rest\/v1\//, ""));
  assert.deepEqual(urls, ["rpc/accept_consent", "rpc/accept_consent", "rpc/accept_consent", "rpc/request_nursing_visit"]);
  assert.equal(calls[2].body.p_kind, "health_data");
  assert.equal(calls[3].body.p_item, 15);
  assert.ok(calls[3].body.p_idempotency_key);
  assert.ok(!calls.some((c) => /\/orders/.test(c.url)));
});

test("nursing items list only intake-open nursing items; section hidden otherwise", async () => {
  const calls = mockFetch([]);
  await dataApi.getNursingItems();
  assert.match(calls[0].url, /nursing_intake_open=eq\.true/);
  assert.match(calls[0].url, /sector=eq\.nursing/);
  assert.match(main, /function nursingSection\(\) \{\s*if \(!Array\.isArray\(state\.nursingItems\) \|\| !state\.nursingItems\.length\) return "";/);
});

test("updateProduct validates name, price and category locally and sends only those fields", async () => {
  const calls = mockFetch([{ id: 1 }]);
  for (const bad of [{ name: "x" }, { price: 0 }, { price: 100001 }, { price: 1.5 }, { category: "weapons" }]) await assert.rejects(dataApi.updateProduct(1, bad));
  assert.equal(calls.length, 0);
  await dataApi.updateProduct(1, { name: "اسم جديد", price: 55, category: "food" });
  assert.deepEqual(calls[0].body, { name: "اسم جديد", price_egp: 55, category: "food" });
});
