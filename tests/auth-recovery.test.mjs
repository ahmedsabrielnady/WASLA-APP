import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
let replacedUrl = null;

globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

globalThis.document = { title: "WASLA test" };
globalThis.window = {
  location: {
    hostname: "wasla-app-gg2f.vercel.app",
    origin: "https://wasla-app-gg2f.vercel.app",
    pathname: "/",
    search: "",
    hash: "#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&expires_in=3600"
  },
  history: {
    replaceState(_state, _title, url) {
      replacedUrl = url;
      window.location.hash = "";
    }
  }
};

const { authApi } = await import("../src/supabase.js");

test("acceptRecoveryFromUrl stores recovery tokens and removes them from the address bar", () => {
  assert.equal(authApi.acceptRecoveryFromUrl(), true);
  const session = JSON.parse(localStorage.getItem("wasla.auth.session.v1"));
  assert.equal(session.access_token, "recovery-access");
  assert.equal(session.refresh_token, "recovery-refresh");
  assert.equal(replacedUrl, "/");
  assert.equal(window.location.hash, "");
});

test("requestPasswordReset calls Supabase Auth with the production callback URL", async (t) => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, status: 200, text: async () => "" };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await authApi.requestPasswordReset("customer@example.com");

  assert.match(captured.url, /\/auth\/v1\/recover\?redirect_to=/);
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(JSON.parse(captured.options.body), { email: "customer@example.com" });
  assert.equal(captured.options.headers.apikey.startsWith("sb_publishable_"), true);
});

test("updatePassword sends the new password with the recovery bearer token", async (t) => {
  localStorage.setItem("wasla.auth.session.v1", JSON.stringify({
    access_token: "recovery-access",
    refresh_token: "recovery-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  }));
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, status: 200, text: async () => '{"id":"user-1"}' };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await authApi.updatePassword("strong-password");

  assert.match(captured.url, /\/auth\/v1\/user$/);
  assert.equal(captured.options.method, "PUT");
  assert.equal(captured.options.headers.Authorization, "Bearer recovery-access");
  assert.deepEqual(JSON.parse(captured.options.body), { password: "strong-password" });
});
