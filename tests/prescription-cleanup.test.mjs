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
  const state = { deleted: false };
  globalThis.fetch = async (url, o = {}) => {
    const method = o.method || "GET";
    calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    const json = (b, status = 200) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(b), { status }));
    if (url.includes("/rpc/submit_prescription_request")) return json("11111111-1111-4111-8111-111111111111");
    if (url.includes("/rpc/attach_prescription_file")) return fail.attach ? json({ message: "x" }, 400) : json(null, 204);
    if (url.includes("/rpc/rx_set_audience")) return fail.audience ? json({ message: "x" }, 400) : json(null, 204);
    if (url.includes("/rpc/customer_close_prescription_request")) return json(null, 204);
    if (url.includes("/storage/v1/object/list/")) {
      if (fail.listFails) return json({}, 500);
      const gone = !fail.listName && (!stored || state.deleted);
      return json(gone && !fail.stillListed ? [] : [{ name: fail.listName || String(stored).split("/").pop() }]);
    }
    if (url.includes("/storage/v1/object/prescriptions/")) {
      if (method === "POST") { if (fail.networkOnUpload) { stored = url; throw new TypeError("network"); } if (fail.upload) return json({}, 500); stored = url; return json({ Key: "k" }); }
      if (method === "DELETE") { if (fail.delete) return json({}, 500); state.deleted = true; return json({ message: "ok" }); }
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
    assert.ok(has(h.calls, "POST /storage/v1/object/list/prescriptions"), "deletion is verified by listing the folder, which is never CDN-cached");
    assert.ok(!has(h.calls, "GET /storage/v1/object/authenticated/"), "no cached GET is used as proof");
    assert.ok(has(h.calls, "customer_close"));
    assert.ok(h.calls.findIndex((c) => c.startsWith("DELETE")) < h.calls.findIndex((c) => c.includes("customer_close")), "delete happens before close");
  });
}
test("when the delete fails the user is told deletion failed and the file may remain; nothing promises automatic deletion; a cleanup record is kept", async () => {
  delete store["wasla.pending-file-cleanup.v1"];
  const h = harness({ audience: true, delete: true, stillListed: true });
  await assert.rejects(dataApi.submitPrescription(good), (e) => /فشل حذف الملف/.test(e.message) && /قد يظل موجودًا/.test(e.message) && !/تلقائي|الاحتفاظ/.test(e.message));
  assert.ok(has(h.calls, "customer_close"));
  const rec = JSON.parse(store["wasla.pending-file-cleanup.v1"]);
  assert.equal(rec.length, 1);
  assert.match(rec[0].path, /^11111111-1111-4111-8111-111111111111\/rx-/);
});
test("a listing that still shows the file, or a listing that fails, is not reported as cleaned", async () => {
  for (const fail of [{ audience: true, stillListed: true }, { audience: true, listFails: true }]) {
    delete store["wasla.pending-file-cleanup.v1"];
    harness(fail);
    await assert.rejects(dataApi.submitPrescription(good), /فشل حذف الملف/);
    assert.equal(JSON.parse(store["wasla.pending-file-cleanup.v1"]).length, 1);
  }
});
test("retryPendingFileCleanups removes the record only when verified, and keeps it otherwise", async () => {
  store["wasla.pending-file-cleanup.v1"] = JSON.stringify([{ path: "11111111-1111-4111-8111-111111111111/rx-1.png", at: 1 }]);
  harness({ stillListed: true, listName: "rx-1.png" });
  assert.equal(await dataApi.retryPendingFileCleanups(), 1);
  assert.equal(JSON.parse(store["wasla.pending-file-cleanup.v1"]).length, 1);
  harness({});
  assert.equal(await dataApi.retryPendingFileCleanups(), 0);
  assert.equal(store["wasla.pending-file-cleanup.v1"], undefined);
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
