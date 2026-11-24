import test from "node:test";
import assert from "node:assert/strict";

// Executes dataApi.quoteOrder and getMyOrders against a stubbed fetch to prove the
// quote flow fails closed on a database without quote_order_v3, and reads fall back.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app", origin: "https://wasla-app-gg2f.vercel.app", pathname: "/", search: "", href: "https://wasla-app-gg2f.vercel.app/", hash: "" }, history: { replaceState() {} } };
globalThis.document = { title: "" };
const { dataApi } = await import("../src/supabase.js");
const { CONFIG } = await import("../src/config.js");

function seedSession() {
  const session = { access_token: "stub-token", refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } };
  store.set("wasla.auth.session.v1", JSON.stringify(session));
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    const { status, body } = handler(String(url), options);
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return calls;
}

test("quoteOrder refuses and never calls legacy quote_order when quote_order_v3 is missing", async (t) => {
  if (CONFIG.isPublicPreview) t.skip("public preview config blocks writes before the network");
  seedSession();
  const calls = stubFetch((url) => url.includes("quote_order_v3")
    ? { status: 404, body: { code: "PGRST202", message: "Could not find the function public.quote_order_v3(p_order, p_price) in the schema cache" } }
    : { status: 200, body: null });
  await assert.rejects(() => dataApi.quoteOrder("o1", 100), /تحديث قاعدة البيانات/);
  assert.ok(calls.some((u) => u.includes("quote_order_v3")));
  assert.ok(!calls.some((u) => /rpc\/quote_order(\?|$)/.test(u)), "legacy quote_order must not be called");
});

test("getMyOrders falls back to base columns when quote columns are missing", async () => {
  seedSession();
  const calls = stubFetch((url) => url.includes("quote_price_egp")
    ? { status: 400, body: { code: "42703", message: "column orders.quote_price_egp does not exist" } }
    : { status: 200, body: [{ id: "o1", status: "new" }] });
  const rows = await dataApi.getMyOrders("u1");
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].includes("quote_price_egp"));
});
