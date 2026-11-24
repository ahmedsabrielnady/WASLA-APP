import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" } };

const { dataApi } = await import("../src/supabase.js");

test("getMyOrderTracking calls the ownership-checked tracking RPC and unwraps its row", async (t) => {
  localStorage.setItem("wasla.auth.session.v1", JSON.stringify({
    access_token: "customer-access-token",
    refresh_token: "customer-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  }));
  const originalFetch = globalThis.fetch;
  let captured = null;
  const row = {
    status: "new",
    sector: "maintenance",
    ref: "WSL-TEST",
    scheduled_at: null,
    queue_position: 1,
    ahead_count: 0,
    events: [{ status: "new", note: "internal note not rendered", at: "2026-11-24T10:00:00Z" }]
  };
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, status: 200, text: async () => JSON.stringify([row]) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await dataApi.getMyOrderTracking("7d98f5a6-4e91-4c38-bbd2-22d3f6c67b40");

  assert.match(captured.url, /\/rest\/v1\/rpc\/my_order_tracking$/);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer customer-access-token");
  assert.deepEqual(JSON.parse(captured.options.body), {
    p_order: "7d98f5a6-4e91-4c38-bbd2-22d3f6c67b40"
  });
  assert.deepEqual(result, row);
});

test("getMyOrderTracking rejects missing order IDs without a network request", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
  try {
    await assert.rejects(dataApi.getMyOrderTracking(""), /الطلب غير محدد/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tracking timeline does not render internal event notes", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /data-action="track-order"/);
  assert.match(main, /statusLabel\(entry\.status\)/);
  assert.doesNotMatch(main, /escapeHTML\(entry\.note\)/);
});
