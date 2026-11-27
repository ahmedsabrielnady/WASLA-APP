import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Mocked only. The error bodies are the exact PostgREST answers production gives today for tables and columns that are not migrated.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.document = { title: "WASLA test" };
globalThis.window = { location: { hostname: "example.test", origin: "https://example.test", pathname: "/", search: "", hash: "", href: "https://example.test/" }, history: { replaceState() {} } };
const { dataApi } = await import("../src/supabase.js");
const realFetch = globalThis.fetch;
const missingTable = (t) => ({ code: "PGRST205", details: null, hint: null, message: `Could not find the table 'public.${t}' in the schema cache` });
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = u.match(/\/rest\/v1\/([a-z_]+)/);
  const t = m && m[1];
  if (/nursing_intake_open/.test(u)) return new Response(JSON.stringify({ code: "42703", message: "column service_items.nursing_intake_open does not exist" }), { status: 400, headers: { "content-type": "application/json" } });
  if (["delivery_requests", "order_change_requests", "lab_tests", "lab_requests", "prescription_requests", "tutor_sessions", "session_enrollments", "courses", "course_enrollments", "notifications", "medical_notes"].includes(t)) {
    return new Response(JSON.stringify(missingTable(t)), { status: 404, headers: { "content-type": "application/json" } });
  }
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};
store.set("wasla.auth.session.v1", JSON.stringify({ access_token: "tok", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } }));
test.after(() => { globalThis.fetch = realFetch; });

const swallowed = async (fn) => { try { return await fn(); } catch { return "threw"; } };

test("not-yet-migrated tables never make the customer orders page fail", async () => {
  // These two are loaded without a try/catch in loadOrders, so they must not throw.
  assert.deepEqual(await dataApi.getMyChangeRequests(), []);
  assert.deepEqual(await dataApi.getMyNotifications(), []);
});

test("delivery, lab, prescription loaders return null so their sections stay hidden", async () => {
  assert.equal(await dataApi.getMyDeliveries(), null);
  assert.equal(await dataApi.getLabTests(), null);
  assert.equal(await dataApi.getMyLabRequests(), null);
  assert.equal(await dataApi.getMyPrescriptions(), null);
});

test("education, courses and nursing loaders either hide or throw into a caller that already catches", async () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  for (const [name, fn] of [["sessions", () => dataApi.getSessions()], ["enrollments", () => dataApi.getMyEnrollments()], ["courses", () => dataApi.getCourses()], ["nursing", () => dataApi.getNursingItems()]]) {
    const r = await swallowed(fn);
    assert.ok(r === "threw" || r === null || (Array.isArray(r) && r.length === 0), name);
  }
  assert.match(main, /try \{\n      const \[sessions, enrollments\] = await Promise\.all\(\[dataApi\.getSessions\(\)/);
  assert.match(main, /soft\(\(\) => dataApi\.getNursingItems\(\), null\)/);
  assert.match(main, /try \{ state\.courses = await dataApi\.getCourses\(\)/);
  assert.match(main, /soft\(\(\) => dataApi\.getMyDeliveries\(\), null\)/);
});

test("clinic booking is closed unless the TEST backend is active, and shows an honest unavailable notice", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
  assert.match(config, /clinicBookingEnabled: ON_TEST_ALIAS/);
  const sec = main.slice(main.indexOf("function clinicSection()"), main.indexOf("function sessionModeLabel"));
  assert.ok(sec.indexOf("clinicBookingEnabled") < sec.indexOf('data-form="clinic-book"'));
  assert.match(sec, /data-capability="clinic-booking-unavailable"/);
  assert.match(main, /clinic-book" && !CONFIG\.clinicBookingEnabled/);
});
