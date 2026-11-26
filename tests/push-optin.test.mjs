import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushConfigured, pushSupported, urlBase64ToUint8Array, enablePush, disablePush } from "../src/push.js";

const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/drafts/20261125003000_push_subscriptions.sql", import.meta.url), "utf8");
const KEY = "B".repeat(87);

test("push stays off until a VAPID public key is configured (shipped config has none)", () => {
  assert.match(config, /pushPublicKey: ""/);
  assert.equal(pushConfigured(""), false);
  assert.equal(pushConfigured(undefined), false);
  assert.equal(pushConfigured("short"), false);
  assert.equal(pushConfigured(KEY), true);
  assert.match(main, /if \(!state\.user\?\.id \|\| !pushConfigured\(CONFIG\.pushPublicKey\) \|\| !pushSupported\(\)\) return ""/);
});

test("service worker shows one fixed generic line and never reads the payload", () => {
  const push = sw.slice(sw.indexOf('addEventListener("push"'), sw.indexOf('addEventListener("notificationclick"'));
  assert.match(push, /عندك إشعار جديد في وصلة/);
  assert.doesNotMatch(push, /event\.data/);
  assert.doesNotMatch(push, /\.json\(\)|\.text\(\)/);
  assert.match(sw, /wasla-shell-v7/);
});

test("support check needs service worker, PushManager and Notification", () => {
  assert.equal(pushSupported({}), false);
  assert.equal(pushSupported({ navigator: { serviceWorker: {} }, PushManager: {} }), false);
  assert.equal(pushSupported({ navigator: { serviceWorker: {} }, PushManager: {}, Notification: {} }), true);
});

test("base64url key decodes to bytes", () => {
  assert.deepEqual([...urlBase64ToUint8Array("AQID")], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array("_-8")], [255, 239]);
});

function fakes({ permission = "granted", sub = { endpoint: "https://push.invalid/x", keys: { p256dh: "p".repeat(30), auth: "a".repeat(12) } }, rpcFails = false } = {}) {
  const calls = { subscribed: 0, unsubscribed: 0, rpc: [], asked: 0 };
  const subscription = { toJSON: () => sub, unsubscribe: async () => { calls.unsubscribed += 1; }, endpoint: sub.endpoint };
  const registration = { pushManager: { subscribe: async () => { calls.subscribed += 1; return subscription; }, getSubscription: async () => subscription } };
  return { calls, registration, requestPermission: async () => { calls.asked += 1; return permission; }, subscribeRpc: async (...a) => { calls.rpc.push(a); if (rpcFails) throw new Error("x"); } };
}

test("enable: not configured never asks permission or subscribes", async () => {
  const f = fakes();
  const r = await enablePush({ publicKey: "", ...f });
  assert.deepEqual([r.ok, r.reason, f.calls.asked, f.calls.subscribed], [false, "not-configured", 0, 0]);
});

test("enable: permission denied subscribes nothing and stores nothing", async () => {
  const f = fakes({ permission: "denied" });
  const r = await enablePush({ publicKey: KEY, ...f });
  assert.deepEqual([r.ok, r.reason, f.calls.subscribed, f.calls.rpc.length], [false, "denied", 0, 0]);
});

test("enable: granted subscribes and stores endpoint and both keys", async () => {
  const f = fakes();
  const r = await enablePush({ publicKey: KEY, ...f });
  assert.equal(r.ok, true);
  assert.equal(f.calls.rpc.length, 1);
  assert.equal(f.calls.rpc[0][0], "https://push.invalid/x");
});

test("enable: server refusal undoes the browser subscription", async () => {
  const f = fakes({ rpcFails: true });
  const r = await enablePush({ publicKey: KEY, ...f });
  assert.deepEqual([r.ok, r.reason, f.calls.unsubscribed], [false, "server-refused", 1]);
});

test("enable: a subscription without keys is rejected and undone", async () => {
  const f = fakes({ sub: { endpoint: "https://push.invalid/x", keys: {} } });
  const r = await enablePush({ publicKey: KEY, ...f });
  assert.deepEqual([r.ok, r.reason, f.calls.rpc.length, f.calls.unsubscribed], [false, "bad-subscription", 0, 1]);
});

test("disable removes the server row and the browser subscription", async () => {
  const f = fakes();
  const removed = [];
  const r = await disablePush({ registration: f.registration, unsubscribeRpc: async (e) => removed.push(e) });
  assert.deepEqual([r.removed, removed, f.calls.unsubscribed], [true, ["https://push.invalid/x"], 1]);
});

test("draft 3000: no app-role table access, https only, device cap, no sender", () => {
  assert.match(sql, /revoke all on public\.push_subscriptions from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /endpoint ~ '\^https:\/\//);
  assert.match(sql, /v_n >= 5/);
  assert.doesNotMatch(sql, /http_post|net\.http|pg_net/i);
});

test("hardening draft 3100: origin allowlist, no takeover, logout releases the device", () => {
  const h = readFileSync(new URL("../supabase/drafts/20261125003100_push_endpoint_hardening.sql", import.meta.url), "utf8");
  assert.match(h, /fcm\\\.googleapis\\\.com/);
  assert.doesNotMatch(h.slice(h.indexOf("alter table")), /windows/);
  assert.match(h, /endpoint belongs to another user/);
  assert.doesNotMatch(h, /delete from public\.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid/);
  const logout = main.slice(main.indexOf('action === "logout"'), main.indexOf("authApi.signOut()", main.indexOf('action === "logout"')));
  assert.match(logout, /disablePush/);
});
