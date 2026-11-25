import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const RID = "11111111-1111-4111-8111-111111111111";

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url: String(url), body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify([]), { status: 200 }); };
  return calls;
}

test("doctor note validates order id and length locally, then calls the checked RPC only", async () => {
  const calls = mockFetch();
  for (const bad of [{ orderId: "x", note: "valid note" }, { orderId: RID, note: "ab" }, { orderId: RID, note: "x".repeat(2001) }, { orderId: RID, note: "   " }]) {
    await assert.rejects(dataApi.doctorAddNote(bad));
  }
  assert.equal(calls.length, 0);
  await dataApi.doctorAddNote({ orderId: RID, note: "  valid note  " });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/doctor_add_note$/);
  assert.deepEqual(calls[0].body, { p_order: RID, p_note: "valid note" });
});

test("the UI never inserts into medical_notes directly", () => {
  assert.doesNotMatch(main + readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8"), /rest\/v1\/medical_notes["`'][^)]*method: "POST"/);
  assert.match(main, /data-form="doctor-note"/);
  assert.match(main, /id="my-notes"/);
});

test("patient notes section renders only for non-doctors and the form only for doctors", () => {
  assert.match(main, /const isDoctor = state\.providerRecord\?\.kind === "doctor"/);
  assert.match(main, /if \(isDoctor\) \{/);
});
