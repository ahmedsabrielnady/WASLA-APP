// RPC WIRING tests for the Home Maintenance order path.
// A fake fetch records calls. Nothing contacts Supabase.
// These check only that each client function calls the intended RPC with the
// intended token and body. They do NOT define or validate order lifecycle
// rules: which transitions are allowed (and that cancel is only valid before
// confirmation) is enforced by the database and must be proven by the
// authenticated E2E plan in docs/09-maintenance-e2e-plan-ar.md.
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.get(k) ?? null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); }
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" } };

const { dataApi } = await import("../src/supabase.js");

function login(token) {
  localStorage.setItem("wasla.auth.session.v1", JSON.stringify({
    access_token: token, refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  }));
}

async function recordCalls(t, run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ path: new URL(String(url)).pathname, auth: options.headers.Authorization, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, text: async () => "{}" };
  };
  t.after(() => { globalThis.fetch = original; });
  await run();
  return calls;
}

test("wiring: place order, staff confirm, provider start and finish use the expected RPCs and tokens", async (t) => {
  const calls = await recordCalls(t, async () => {
    login("customer-token");
    await dataApi.createServiceOrder({ id: 1, sector: "maintenance" }, { address: "شبين القناطر - شارع الاختبار", notes: "", idempotencyKey: "k-1" });
    login("staff-token");
    await dataApi.updateOrderStatus("o-1", "confirmed");
    login("provider-token");
    await dataApi.providerSetOrderStatus("o-1", "in_progress");
    await dataApi.providerSetOrderStatus("o-1", "done");
  });
  assert.deepEqual(calls.map(c => c.path), [
    "/rest/v1/rpc/place_order_v2",
    "/rest/v1/rpc/staff_set_order_status_v2",
    "/rest/v1/rpc/provider_set_order_status_v2",
    "/rest/v1/rpc/provider_set_order_status_v2"
  ]);
  assert.deepEqual(calls.map(c => c.auth), ["Bearer customer-token", "Bearer staff-token", "Bearer provider-token", "Bearer provider-token"]);
  assert.equal(calls[0].body.p_idempotency_key, "k-1");
});

test("wiring: customer cancel calls its own RPC (validity of cancelling is decided by the database, not this test)", async (t) => {
  const calls = await recordCalls(t, async () => {
    login("customer-token");
    await dataApi.customerCancelOrder("o-2", "اختبار");
  });
  assert.deepEqual(calls.map(c => c.path), ["/rest/v1/rpc/customer_cancel_order_v2"]);
  assert.equal(calls[0].auth, "Bearer customer-token");
});

test("providers cannot send statuses other than in_progress or done from the client", async () => {
  login("provider-token");
  await assert.rejects(dataApi.providerSetOrderStatus("o-1", "confirmed"));
  await assert.rejects(dataApi.providerSetOrderStatus("o-1", "cancelled"));
});
