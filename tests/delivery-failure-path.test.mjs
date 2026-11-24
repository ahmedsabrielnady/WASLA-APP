import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Executes the delivery client calls against a stubbed fetch to prove errors propagate
// (no silent success), and checks the draft SQL keeps every state guard.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app", origin: "https://wasla-app-gg2f.vercel.app", pathname: "/", search: "", href: "https://wasla-app-gg2f.vercel.app/", hash: "" }, history: { replaceState() {} } };
globalThis.document = { title: "" };
const { dataApi } = await import("../src/supabase.js");

function seedSession() {
  store.set("wasla.auth.session.v1", JSON.stringify({ access_token: "stub-token", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } }));
}
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return calls;
}

test("assignDelivery rejects missing ids without calling the network", async () => {
  seedSession();
  const calls = stubFetch(204, null);
  await assert.rejects(dataApi.assignDelivery("", "c1"));
  await assert.rejects(dataApi.assignDelivery("r1", ""));
  assert.equal(calls.length, 0);
});

test("assignDelivery and courierSetDeliveryStatus surface a database refusal", async () => {
  seedSession();
  stubFetch(403, { message: "الطلب غير مسند إليك", code: "42501" });
  await assert.rejects(dataApi.assignDelivery("r1", "c1"), /مسند|غير|مصرح|403/);
  await assert.rejects(dataApi.courierSetDeliveryStatus("r1", "picked_up"), /مسند|غير|مصرح|403/);
});

test("delivery calls without a session fail instead of sending", async () => {
  store.clear();
  const calls = stubFetch(204, null);
  await assert.rejects(dataApi.assignDelivery("r1", "c1"), /سجل الدخول/);
  await assert.rejects(dataApi.courierSetDeliveryStatus("r1", "delivered"), /سجل الدخول/);
  assert.equal(calls.length, 0);
});

test("delivery queue read returns null (section hidden) when the table is missing", async () => {
  seedSession();
  stubFetch(404, { code: "42P01", message: "Could not find the table 'public.delivery_requests' in the schema cache" });
  const r = await dataApi.getDeliveryQueue();
  assert.ok(r === null || (Array.isArray(r) && r.length === 0));
});

test("draft SQL keeps every delivery guard", async () => {
  const sql = await readFile(new URL("../supabase/drafts/20261125000100_delivery_requests.sql", import.meta.url), "utf8");
  assert.match(sql, /customer_fee_egp\s+int\s+not null default 0 check \(customer_fee_egp = 0\)/);
  assert.match(sql, /where id=p_request and status='new'/);
  assert.match(sql, /kind='courier' and approved and active/);
  assert.match(sql, /v_row\.courier_id is distinct from v_me/);
  assert.match(sql, /status='assigned' and p_to='picked_up'\) or \(v_row\.status='picked_up' and p_to='delivered'/);
  assert.match(sql, /customer_id=\(select auth\.uid\(\)\)\s+and status='new'/);
  assert.match(sql, /kind='terms'/);
  assert.match(sql, /kind='privacy'/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon/);
});

test("UI gates delivery actions by role and busy state", async () => {
  const js = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(js, /state\.profile\?\.role !== "courier"/);
  assert.match(js, /\["staff", "admin"\]\.includes\(state\.profile\?\.role\)\) throw new Error\("غير مصرح بتعيين المندوب/);
  const buttons = js.match(/data-action="courier-delivery"[^>]*>/g) || [];
  assert.ok(buttons.length >= 2);
  for (const b of buttons) assert.match(b, /state\.busy/);
});
