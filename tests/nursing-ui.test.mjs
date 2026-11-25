import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function mockFetch(reply = [{ out_order_id: "x" }]) {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url: String(url), method: o.method || "GET", body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify(reply), { status: 200 }); };
  return calls;
}
const good = { itemId: 15, address: "عنوان اختبار طويل 9", notes: "x", consent: true, terms: true };

test("requestNursingVisit needs terms, health consent, item and address before any request", async () => {
  const calls = mockFetch();
  for (const bad of [{ consent: false }, { consent: undefined }, { terms: false }, { itemId: "x" }, { address: "قصير" }]) {
    await assert.rejects(dataApi.requestNursingVisit({ ...good, ...bad }));
  }
  assert.equal(calls.length, 0);
});

test("requestNursingVisit records consent first, then calls only the nursing RPC", async () => {
  const calls = mockFetch();
  await dataApi.requestNursingVisit(good);
  const urls = calls.map((c) => c.url.replace(/^.*\/rest\/v1\//, ""));
  assert.deepEqual(urls, ["rpc/accept_consent", "rpc/accept_consent", "rpc/accept_consent", "rpc/request_nursing_visit"]);
  assert.equal(calls[2].body.p_kind, "health_data");
  assert.equal(calls[3].body.p_item, 15);
  assert.ok(calls[3].body.p_idempotency_key);
  assert.ok(!calls.some((c) => /\/orders/.test(c.url)));
});

test("nursing items list only intake-open nursing items; section hidden otherwise", async () => {
  const calls = mockFetch([]);
  await dataApi.getNursingItems();
  assert.match(calls[0].url, /nursing_intake_open=eq\.true/);
  assert.match(calls[0].url, /sector=eq\.nursing/);
  assert.match(main, /function nursingSection\(\) \{\s*if \(!Array\.isArray\(state\.nursingItems\) \|\| !state\.nursingItems\.length\) return "";/);
});

test("updateProduct validates name, price and category locally and sends only those fields", async () => {
  const calls = mockFetch([{ id: 1 }]);
  for (const bad of [{ name: "x" }, { price: 0 }, { price: 100001 }, { price: 1.5 }, { category: "weapons" }]) await assert.rejects(dataApi.updateProduct(1, bad));
  assert.equal(calls.length, 0);
  await dataApi.updateProduct(1, { name: "اسم جديد", price: 55, category: "food" });
  assert.deepEqual(calls[0].body, { name: "اسم جديد", price_egp: 55, category: "food" });
});

const { renderOperationsView } = await import("../src/operations.js");
const provs = [
  { id: "p1", kind: "doctor", display_name: "د. معتمد", approved: true, active: true, is_test: false, nursing_credential_verified: true },
  { id: "p2", kind: "technician", display_name: "فني غير معتمد", approved: true, active: true, is_test: false, nursing_credential_verified: false }
];
const nOrder = { id: "o1", sector: "nursing", status: "new", ref: "OR-1", created_at: "2026-11-25T00:00:00Z", price_egp: 120, deposit_egp: 0, provider_id: null, address: "x" };

test("nursing assignment lists only credentialed providers; credential section for staff", () => {
  const html = renderOperationsView({ profile: { role: "staff" }, services: [], orders: [nOrder], providers: provs, preview: false, saving: false });
  const form = html.split('data-form="operations-assign"')[1] || "";
  assert.match(form, /د\. معتمد/);
  assert.doesNotMatch(form, /فني غير معتمد/);
  assert.match(html, /id="nursing-credentials"/);
  assert.match(html, /data-action="set-nursing-credential" data-provider-id="p2" data-verified="yes"/);
  assert.match(html, /data-action="set-nursing-credential" data-provider-id="p1" data-verified="no"/);
});

test("no credentialed provider shows a message, not an assign form", () => {
  const html = renderOperationsView({ profile: { role: "staff" }, services: [], orders: [nOrder], providers: [provs[1]], preview: false, saving: false });
  assert.doesNotMatch(html, /data-form="operations-assign"/);
  assert.match(html, /لا يوجد مقدم خدمة معتمد للتمريض/);
});

test("setNursingCredential calls only the staff RPC", async () => {
  const calls = mockFetch([]);
  await dataApi.setNursingCredential("p1", true);
  assert.match(calls[0].url, /rpc\/staff_set_nursing_credential$/);
  assert.deepEqual(calls[0].body, { p_provider: "p1", p_verified: true });
});

test("teacherCreateSession routes to the linked RPC only when a course is chosen", async () => {
  const calls = mockFetch("00000000-0000-0000-0000-000000000001");
  const v = { title: "حصة جديدة", subject: "رياضيات", starts: "2030-01-01T10:00", seats: 5, price: 0, mode: "online" };
  await dataApi.teacherCreateSession(v);
  assert.match(calls[0].url, /rpc\/teacher_create_session$/);
  await dataApi.teacherCreateSession({ ...v, course: "c1" });
  assert.match(calls[1].url, /rpc\/teacher_create_course_session$/);
  assert.equal(calls[1].body.p_course, "c1");
  assert.ok(!("p_price" in calls[1].body));
});

test("getSessions falls back to standalone sessions when the course link is not installed", async () => {
  let n = 0;
  globalThis.fetch = async () => (n++ === 0 ? new Response(JSON.stringify({ message: "column tutor_sessions.course_id does not exist" }), { status: 400 }) : new Response(JSON.stringify([{ id: "s1" }]), { status: 200 }));
  const rows = await dataApi.getSessions();
  assert.equal(rows[0].course_id, null);
});

test("nursing time: preferred time is labelled as a proposal and the agreed time is separate", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/supabase.js", import.meta.url), "utf8");
  assert.match(main, /الموعد المؤكد:/);
  assert.match(main, /الموعد المقترح منك:[^`]*مقترح فقط/);
  assert.match(main, /order\.preferred_at && !order\.scheduled_at/);
  assert.match(main, /name="preferred_at"/);
  assert.match(api, /set_nursing_preferred_time/);
  assert.match(api, /preferredTimeSaved: false/);
  assert.doesNotMatch(main, /رسوم إلغاء|غرامة/);
});

test("staff scheduling: only open nursing orders get the form, the patient's time is shown as a proposal, input is Cairo-checked", () => {
  const ops = readFileSync(new URL("../src/operations.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
  assert.match(ops, /order\.sector === "nursing" && \["new", "confirmed"\]\.includes\(order\.status\)/);
  assert.match(ops, /الموعد المقترح من المريض:[^`]*\(مقترح فقط\)/);
  assert.match(ops, /الموعد المؤكد:/);
  assert.match(main, /operations-schedule/);
  assert.match(api, /staff_schedule_order/);
  assert.match(api, /resolveCairoLocal\(value\)[\s\S]*staff_schedule_order/);
  assert.match(api, /preferred_at/);
});

test("change requests: requested vs executed are separate labels in customer and staff views", () => {
  const ops = readFileSync(new URL("../src/operations.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
  assert.match(main, /applied: "تم التنفيذ", declined: "تمت المراجعة بدون تغيير"/);
  assert.match(main, /open: "طلبك مفتوح، لسه ماتراجعش"/);
  assert.match(main, /order\.status === "confirmed"\) kinds\.unshift\(\["change_time"/);
  assert.match(main, /ده طلب بس/);
  assert.match(ops, /data-status="applied"[\s\S]*data-status="declined"/);
  assert.match(ops, /\(طلب فقط\)/);
  assert.match(api, /customer_request_order_change/);
  assert.match(api, /staff_resolve_order_change/);
  const panel = main.slice(main.indexOf("function changeRequestPanel"), main.indexOf("function formatAppointment"));
  const staffPanel = ops.slice(ops.indexOf("function renderChangeRequests"), ops.indexOf("function renderNursingCredentialManager"));
  assert.ok(panel.length > 200 && staffPanel.length > 200);
  assert.doesNotMatch(panel + staffPanel, /رسوم|غرامة|استرداد|ج\.م/);
});
