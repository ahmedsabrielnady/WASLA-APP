import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url, body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify("ok"), { status: 200 }); };
  return calls;
}
const RID = "11111111-1111-4111-8111-111111111111";

test("pharmacy quote validates price and eta locally and sends the delivery answer", async () => {
  const calls = mockFetch();
  for (const bad of [{ price: 0 }, { price: 20001 }, { price: 10.5 }, { price: 50, eta: 1 }, { price: 50, eta: 5000 }]) {
    await assert.rejects(dataApi.pharmacyQuote({ requestId: RID, ...bad }));
  }
  await assert.rejects(dataApi.pharmacyQuote({ price: 50 }));
  assert.equal(calls.length, 0);
  await dataApi.pharmacyQuote({ requestId: RID, price: "65", note: " ok ", delivery: true, eta: "40" });
  assert.deepEqual(calls[0].body, { p_request: RID, p_price: 65, p_note: "ok", p_delivery: true, p_eta: 40 });
});

test("lab test upsert only accepts lab or radiology kinds and a valid name and price", async () => {
  const calls = mockFetch();
  await assert.rejects(dataApi.upsertLabTest({ kind: "pharmacy", name: "CBC test", price: 50 }));
  await assert.rejects(dataApi.upsertLabTest({ kind: "lab", name: "ab", price: 50 }));
  await assert.rejects(dataApi.upsertLabTest({ kind: "lab", name: "CBC test", price: 0 }));
  assert.equal(calls.length, 0);
  await dataApi.upsertLabTest({ kind: "radiology", name: "Chest X-ray", price: "150" });
  assert.deepEqual(calls[0].body, { p_name: "Chest X-ray", p_kind: "radiology", p_price: 150 });
});

test("file URL helper refuses paths that are not request-folder/file", async () => {
  const calls = mockFetch();
  for (const bad of ["../x", "a/b", "", null, `${RID}/../../x`, `${RID}/a/b.png`]) await assert.rejects(dataApi.getPrescriptionFileUrl(bad));
  assert.equal(calls.length, 0);
});

test("provider health UI is driven by the provider specialty and shows only audience-directed requests", () => {
  assert.match(main, /data-form="pharmacy-quote"/);
  assert.match(main, /data-form="lab-test"/);
  assert.match(main, /الطلبات التي اختارك العميل لها/);
  assert.match(main, /provider\.kind !== "merchant"/);
});
