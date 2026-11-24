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
  assert.match(js, /if \(!Array\.isArray\(state\.products\) \|\| !state\.products\.length\) return ""/);
  assert.match(js, /الحجز متاح لحسابات العملاء فقط/);
  assert.match(js, /الطلب متاح لحسابات العملاء فقط/);
  assert.match(js, /dataApi\.acceptRequiredConsents\(\);\s*await dataApi\.bookClinicSlot/);
  assert.match(js, /تنبيه داخل التطبيق فقط/);
});
