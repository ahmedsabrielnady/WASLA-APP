import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app", origin: "https://wasla-app-gg2f.vercel.app", pathname: "/", search: "", href: "https://wasla-app-gg2f.vercel.app/", hash: "" }, history: { replaceState() {} } };
globalThis.document = { title: "" };
const { dataApi } = await import("../src/supabase.js");
const { renderProviderView } = await import("../src/provider.js");

function seed() { store.set("wasla.auth.session.v1", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } })); }
function stub(status, body) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null }); return { ok: status < 400, status, text: async () => JSON.stringify(body) }; };
  return calls;
}

test("clinic slots: invalid input never hits the network", async () => {
  seed(); const calls = stub(200, []);
  assert.deepEqual(await dataApi.getClinicSlots("", "2026-11-26"), []);
  assert.deepEqual(await dataApi.getClinicSlots("p1", "26/11/2026"), []);
  assert.equal(calls.length, 0);
});

test("clinic slots map RPC rows to timestamps", async () => {
  seed(); const calls = stub(200, [{ slot: "2026-11-26T08:00:00+00:00" }, { slot: "2026-11-26T08:30:00+00:00" }]);
  assert.deepEqual(await dataApi.getClinicSlots("p1", "2026-11-26"), ["2026-11-26T08:00:00+00:00", "2026-11-26T08:30:00+00:00"]);
  assert.match(calls[0].url, /rpc\/clinic_available_slots/);
});

test("booking validates input and maps a disabled database to a clear message", async () => {
  seed(); stub(204, null);
  await assert.rejects(dataApi.bookClinicSlot("", "x"), /اختر/);
  stub(403, { message: "permission denied for function book_clinic_slot", code: "42501" });
  await assert.rejects(dataApi.bookClinicSlot("p1", "2026-11-26T08:00:00+00:00"), /غير مفعل/);
});

test("booking surfaces a slot-taken refusal and sends only the expected body", async () => {
  seed(); stub(400, { message: "الموعد اتحجز قبل ما تخلص، اختار موعد تاني", code: "23505" });
  await assert.rejects(dataApi.bookClinicSlot("p1", "s", "ملاحظة"), /اتحجز|الموعد/);
  const calls = stub(200, [{ out_order_id: "o1" }]);
  await dataApi.bookClinicSlot("p1", "2026-11-26T08:00:00+00:00", "ملاحظة");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["p_at", "p_notes", "p_provider", "p_source"]);
  assert.equal("price" in calls[0].body, false);
});

test("product order validates quantity and address and never sends a price", async () => {
  seed(); const calls = stub(200, [{ out_order_id: "o1" }]);
  await assert.rejects(dataApi.placeProductOrder("", 1, "عنوان 123"), /اختر/);
  await assert.rejects(dataApi.placeProductOrder("1", 0, "عنوان 123"), /الكمية/);
  await assert.rejects(dataApi.placeProductOrder("1", 21, "عنوان 123"), /الكمية/);
  await assert.rejects(dataApi.placeProductOrder("1", 1.5, "عنوان 123"), /الكمية/);
  await assert.rejects(dataApi.placeProductOrder("1", 1, "ab"), /عنوان/);
  assert.equal(calls.length, 0);
  await dataApi.placeProductOrder("1", 2, "عنوان 123");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["p_address", "p_notes", "p_product", "p_qty", "p_source"]);
});

test("product order maps a disabled database and an out-of-stock refusal", async () => {
  seed(); stub(403, { message: "permission denied for function place_product_order", code: "42501" });
  await assert.rejects(dataApi.placeProductOrder("1", 1, "عنوان 123"), /غير مفعل/);
  stub(400, { message: "الكمية المطلوبة مش متوفرة", code: "22023" });
  await assert.rejects(dataApi.placeProductOrder("1", 1, "عنوان 123"), /متوفرة/);
});

test("doctor appointment status rejects unknown states without calling the network", async () => {
  seed(); const calls = stub(204, null);
  await assert.rejects(dataApi.doctorSetAppointmentStatus("o1", "new"), /غير صالح/);
  await assert.rejects(dataApi.doctorSetAppointmentStatus("", "confirmed"), /غير صالح/);
  assert.equal(calls.length, 0);
});

test("provider view offers doctor actions for clinic orders only", () => {
  const provider = { id: "p", kind: "doctor", display_name: "د. اختبار", approved: true, active: true, is_test: false };
  const html = renderProviderView({ profile: { role: "doctor" }, provider, orders: [
    { id: "o1", ref: "OR-1", sector: "clinic", status: "new", created_at: "2026-11-25T00:00:00Z", scheduled_at: "2026-11-26T08:00:00Z" },
    { id: "o2", ref: "OR-2", sector: "clinic", status: "confirmed", created_at: "2026-11-25T00:00:00Z" },
    { id: "o3", ref: "OR-3", sector: "clinic", status: "done", created_at: "2026-11-25T00:00:00Z" }
  ] });
  assert.match(html, /data-kind="clinic"[^>]*data-order-id="o1"[^>]*data-status="confirmed"/);
  assert.match(html, /data-order-id="o2"[^>]*data-status="in_progress"/);
  assert.equal(/data-order-id="o3"/.test(html), false);
  const other = renderProviderView({ profile: { role: "technician" }, provider: { ...provider, kind: "technician" }, orders: [{ id: "o4", ref: "OR-4", sector: "maintenance", status: "new", created_at: "2026-11-25T00:00:00Z" }] });
  assert.equal(/provider-set-status/.test(other), false);
});

test("UI hides clinic and store sections unless the database returns data, and guards role and consent", async () => {
  const js = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(js, /if \(!Array\.isArray\(state\.doctors\) \|\| !state\.doctors\.length\) return ""/);
  assert.match(js, /\(p\.category \|\| "market"\) === category/);
  assert.match(js, /if \(!items\.length\) return ""/);
  assert.match(js, /الحجز متاح لحسابات العملاء فقط/);
  assert.match(js, /الطلب متاح لحسابات العملاء فقط/);
  assert.match(js, /dataApi\.acceptRequiredConsents\(\);\s*await dataApi\.bookClinicSlot/);
  assert.match(js, /تنبيه داخل التطبيق فقط/);
});

test("education: session create validates input locally", async () => {
  seed(); const calls = stub(200, "id");
  const ok = { title: "رياضيات", subject: "رياضيات", starts: "2026-12-01T10:00", seats: 5, price: 50, mode: "online" };
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, title: "ab" }), /عنوان/);
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, starts: "" }), /موعد/);
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, seats: 0 }), /المقاعد/);
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, seats: 31 }), /المقاعد/);
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, price: -1 }), /السعر/);
  await assert.rejects(dataApi.teacherCreateSession({ ...ok, mode: "x" }), /نوع/);
  assert.equal(calls.length, 0);
  await dataApi.teacherCreateSession(ok);
  assert.match(calls[0].url, /rpc\/teacher_create_session/);
});

test("education: enroll and cancel surface refusals; missing tables hide the section", async () => {
  seed(); stub(400, { message: "الحصة مكتملة العدد", code: "22023" });
  await assert.rejects(dataApi.enrollInSession("s1"), /مكتملة/);
  stub(403, { message: "permission denied for function enroll_in_session", code: "42501" });
  await assert.rejects(dataApi.enrollInSession("s1"), /غير مفعل/);
  await assert.rejects(dataApi.enrollInSession(""), /اختر/);
  stub(404, { message: "Could not find the table 'public.tutor_sessions' in the schema cache" });
  assert.equal(await dataApi.getSessions(), null);
  stub(404, { message: "Could not find the table 'public.session_enrollments' in the schema cache" });
  assert.equal(await dataApi.getMyEnrollments(), null);
});

test("education UI is hidden without data and guarded by role", async () => {
  const js = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(js, /if \(!Array\.isArray\(state\.sessions\)/);
  assert.match(js, /state\.profile\?\.role !== "teacher" \|\| !Array\.isArray\(state\.teacherSessions\)/);
  assert.match(js, /التسجيل متاح لحسابات العملاء فقط/);
  assert.match(js, /هذه العملية للمدرس فقط/);
});

test("education draft SQL keeps seats, role, consent and ownership guards and stays out of migrations", async () => {
  const sql = await readFile(new URL("../supabase/drafts/20261125000200_education_sessions.sql", import.meta.url), "utf8");
  assert.match(sql, /from public\.tutor_sessions where id=p_session for update/);
  assert.match(sql, /v_taken >= v_s\.seats/);
  assert.match(sql, /session_enrollments_one_active/);
  assert.match(sql, /kind='terms'/);
  assert.match(sql, /kind='privacy'/);
  assert.match(sql, /p\.user_id=\(select auth\.uid\(\)\) and p\.kind='teacher'/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon/);
});

test("products: category column missing falls back to market; present category is kept", async () => {
  seed();
  let n = 0;
  globalThis.fetch = async (url) => {
    n += 1;
    const u = String(url);
    if (n === 1) return { ok: false, status: 400, text: async () => JSON.stringify({ message: "column products.category does not exist" }) };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1, name: "أرز", price_egp: 40, stock: 3 }]) };
  };
  const rows = await dataApi.getProducts();
  assert.equal(rows[0].category, "market");
  stub(200, [{ id: 2, name: "وجبة", price_egp: 35, stock: 3, category: "food" }]);
  assert.equal((await dataApi.getProducts())[0].category, "food");
  stub(500, { message: "boom" });
  await assert.rejects(dataApi.getProducts(), /boom/);
});

test("food draft SQL restricts category values and stays out of migrations", async () => {
  const sql = await readFile(new URL("../supabase/drafts/20261125000300_products_category.sql", import.meta.url), "utf8");
  assert.match(sql, /check \(category in \('market','food'\)\)/);
  assert.match(sql, /default 'market'/);
});
