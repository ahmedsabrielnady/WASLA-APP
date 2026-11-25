import test from "node:test";
import assert from "node:assert/strict";

// Mocked only: no network, no real account. Covers how linkGoogle behaves when Supabase refuses to link.
const store = new Map();
const session = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
let assigned = null;
globalThis.document = { title: "WASLA test" };
globalThis.window = { location: { hostname: "example.test", origin: "https://example.test", pathname: "/", search: "", hash: "", href: "https://example.test/", assign(u) { assigned = u; } }, history: { replaceState() {} } };

const { authApi } = await import("../src/supabase.js");
const realFetch = globalThis.fetch;
let calls = [];
function mockFetch(status, body) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}
function signIn() {
  store.set("wasla.auth.session.v1", JSON.stringify({ access_token: "tok", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } }));
}
test.afterEach(() => { globalThis.fetch = realFetch; calls = []; assigned = null; session.clear(); store.clear(); });

test("linkGoogle refuses without a session and makes no request", async () => {
  mockFetch(200, { url: "https://x" });
  await assert.rejects(() => authApi.linkGoogle(), /سجل الدخول/);
  assert.equal(calls.length, 0);
  assert.equal(assigned, null);
});

test("when Supabase says the identity is already linked, nothing redirects and the verifier is cleared", async () => {
  signIn();
  mockFetch(422, { msg: "Identity is already linked to another user" });
  await assert.rejects(() => authApi.linkGoogle(), /already linked/);
  assert.equal(assigned, null);
  assert.equal(session.size, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/user\/identities\/authorize\?/);
  assert.equal(calls[0].init.method, "GET");
});

test("when manual linking is disabled (403) the user sees an error and no redirect happens", async () => {
  signIn();
  mockFetch(403, { msg: "Manual linking is disabled" });
  await assert.rejects(() => authApi.linkGoogle(), /disabled/);
  assert.equal(assigned, null);
  assert.equal(session.size, 0);
});

test("a response without a url shows the safe message and clears the verifier", async () => {
  signIn();
  mockFetch(200, {});
  await assert.rejects(() => authApi.linkGoogle(), /تعذر بدء ربط Google/);
  assert.equal(assigned, null);
  assert.equal(session.size, 0);
});

test("success redirects only to the url Supabase returned and sends only the bearer token and PKCE challenge", async () => {
  signIn();
  mockFetch(200, { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
  await authApi.linkGoogle();
  assert.equal(assigned, "https://accounts.google.com/o/oauth2/v2/auth?x=1");
  assert.equal(session.size, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("provider"), "google");
  assert.equal(u.searchParams.get("code_challenge_method"), "s256");
  assert.ok(u.searchParams.get("code_challenge").length >= 40);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.body, undefined);
});
