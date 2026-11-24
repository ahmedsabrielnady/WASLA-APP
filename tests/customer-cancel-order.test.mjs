import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.window = {
  location: { hostname: "wasla-app-gg2f.vercel.app" }
};

const { dataApi } = await import("../src/supabase.js");

test("customerCancelOrder calls the authenticated customer cancellation RPC", async (t) => {
  localStorage.setItem("wasla.auth.session.v1", JSON.stringify({
    access_token: "customer-access-token",
    refresh_token: "customer-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  }));
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, status: 200, text: async () => "" };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await dataApi.customerCancelOrder("7d98f5a6-4e91-4c38-bbd2-22d3f6c67b40", "إلغاء بطلب العميل");

  assert.match(captured.url, /\/rest\/v1\/rpc\/customer_cancel_order_v2$/);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer customer-access-token");
  assert.deepEqual(JSON.parse(captured.options.body), {
    p_order: "7d98f5a6-4e91-4c38-bbd2-22d3f6c67b40",
    p_reason: "إلغاء بطلب العميل"
  });
});

test("customerCancelOrder rejects missing order IDs and oversized reasons before network access", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
  try {
    await assert.rejects(dataApi.customerCancelOrder(""), /الطلب غير محدد/);
    await assert.rejects(dataApi.customerCancelOrder("order-1", "x".repeat(501)), /500 حرف/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
