import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" } };

const { authApi, dataApi } = await import("../src/supabase.js");

const session = () => localStorage.setItem("wasla.auth.session.v1", JSON.stringify({
  access_token: "customer-access-token",
  refresh_token: "customer-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600
}));

test("signup stores the exact policy versions in auth user metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "customer-1" }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await authApi.signUp({ email: "customer@example.test", password: "StrongPass123!", fullName: "Test Customer", phone: "01012345678" });

  assert.equal(payload.data.terms_version, "draft-2026-11-24.2");
  assert.equal(payload.data.privacy_version, "draft-2026-11-24.2");
  assert.ok(Number.isFinite(Date.parse(payload.data.consent_accepted_at)));
});

test("signup consent is synchronized on a different device when no local pending flag exists", async (t) => {
  session();
  let consentWrites = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.includes("/rest/v1/consents?")) {
      return { ok: true, status: 200, text: async () => "[]" };
    }
    if (address.endsWith("/rest/v1/rpc/accept_consent")) {
      consentWrites.push(JSON.parse(options.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    throw new Error("Unexpected request: " + address);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await dataApi.completePendingConsent({
    id: "customer-1",
    user_metadata: {
      terms_version: "draft-2026-11-24.2",
      privacy_version: "draft-2026-11-24.2",
      consent_accepted_at: "2026-11-24T16:00:00.000Z"
    }
  });

  assert.deepEqual(consentWrites.map((entry) => entry.p_kind).sort(), ["privacy", "terms"]);
  assert.ok(consentWrites.every((entry) => entry.p_version === "draft-2026-11-24.2"));
});

test("already synchronized consent versions are not written again", async (t) => {
  session();
  const originalFetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/rest/v1/consents?")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { kind: "terms", version: "draft-2026-11-24.2" },
          { kind: "privacy", version: "draft-2026-11-24.2" }
        ])
      };
    }
    writes += 1;
    return { ok: true, status: 200, text: async () => "" };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await dataApi.completePendingConsent({
    id: "customer-1",
    user_metadata: {
      terms_version: "draft-2026-11-24.2",
      privacy_version: "draft-2026-11-24.2",
      consent_accepted_at: "2026-11-24T16:00:00.000Z"
    }
  });

  assert.equal(writes, 0);
});

test("offline consent synchronization preserves the pending marker for retry", async () => {
  session();
  localStorage.setItem("wasla.pending-consent.v1", "1");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network offline"); };
  try {
    await assert.rejects(dataApi.completePendingConsent({ id: "customer-1" }), /تعذر الاتصال بالخدمة/);
    assert.equal(localStorage.getItem("wasla.pending-consent.v1"), "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
