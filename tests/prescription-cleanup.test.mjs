import test from "node:test";
import assert from "node:assert/strict";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");

// Failure injection: `fail` names the step that breaks. Everything else succeeds. No network is used.
function harness(fail = {}) {
  const calls = [];
  let stored = false;
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || "GET";
    calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    const json = (b, status = 200) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(b), { status }));
    if (url.includes("/rpc/submit_prescription_request")) return json("11111111-1111-4111-8111-111111111111");
    if (url.includes("/rpc/attach_prescription_file")) return fail.attach ? json({ message: "x" }, 400) : json(null, 204);
    if (url.includes("/rpc/rx_set_audience")) return fail.audience ? json({ message: "x" }, 400) : json(null, 204);
    if (url.includes("/rpc/customer_close_prescription_request")) return json(null, 204);
    if (url.includes("/storage/v1/object/authenticated/")) return new Response("x", { status: fail.stillReadable ? 200 : 404 });
    if (url.includes("/storage/v1/object/prescriptions/")) {
      if (method === "POST") { if (fail.networkOnUpload) { stored = true; throw new TypeError("network"); } if (fail.upload) return json({}, 500); stored = true; return json({ Key: "k" }); }
      if (method === "DELETE") return fail.delete ? json({}, 500) : json({ message: "ok" });
    }
    return json({}, 404);
  };
  return { calls, wasStored: () => stored };
}
const file = new Blob(["x"], { type: "image/png" });
const good = { note: "أموكسيسيلين 500 (تجريبي)", file, pharmacies: ["p1"], consent: true };
const has = (calls, part) => calls.some((c) => c.includes(part));

test("success path: upload, attach, audience; no delete", async () => {
  const h = harness();
  await dataApi.submitPrescription(good);
  assert.ok(has(h.calls, "POST /storage/v1/object/prescriptions/"));
  assert.ok(!has(h.calls, "DELETE"));
  assert.ok(!has(h.calls, "customer_close"));
});
for (const [name, fail] of [["audience step fails", { audience: true }], ["attach step fails", { attach: true }], ["upload returns an error", { upload: true }], ["network drops during upload (file may be stored)", { networkOnUpload: true }]]) {
  test(`compensation when ${name}: file deleted through the Storage API, verified, request closed`, async () => {
    const h = harness(fail);
    await assert.rejects(dataApi.submitPrescription(good));
    assert.ok(has(h.calls, "DELETE /storage/v1/object/prescriptions/11111111"));
    assert.ok(has(h.calls, "GET /storage/v1/object/authenticated/prescriptions/11111111"), "deletion is verified by a read");
    assert.ok(has(h.calls, "customer_close"));
    assert.ok(h.calls.findIndex((c) => c.startsWith("DELETE")) < h.calls.findIndex((c) => c.includes("customer_close")), "delete happens before close");
  });
}
test("when the delete itself fails the user is told the file stays until the retention period and the request is still closed", async () => {
  const h = harness({ audience: true, delete: true });
  await assert.rejects(dataApi.submitPrescription(good), /الاحتفاظ/);
  assert.ok(has(h.calls, "customer_close"));
});
test("a file that is still readable after delete is not reported as cleaned", async () => {
  harness({ audience: true, stillReadable: true });
  await assert.rejects(dataApi.submitPrescription(good), /الاحتفاظ/);
});
test("no file: a failure does not touch storage", async () => {
  const h = harness({ audience: true });
  await assert.rejects(dataApi.submitPrescription({ ...good, file: null }));
  assert.ok(!has(h.calls, "/storage/"));
  assert.ok(has(h.calls, "customer_close"));
});
test("missing consent or audience fails before any request", async () => {
  const h = harness();
  await assert.rejects(dataApi.submitPrescription({ ...good, consent: false }));
  await assert.rejects(dataApi.submitPrescription({ ...good, pharmacies: [] }));
  assert.equal(h.calls.length, 0);
});
