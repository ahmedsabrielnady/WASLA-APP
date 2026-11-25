import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rxfn-"));
copyFileSync(new URL("../supabase/functions/rx-file/index.ts", import.meta.url), join(dir, "file.mjs"));
copyFileSync(new URL("../supabase/functions/rx-retention/index.ts", import.meta.url), join(dir, "ret.mjs"));
const file = await import(join(dir, "file.mjs"));
const ret = await import(join(dir, "ret.mjs"));
const env = { SUPABASE_URL: "https://x.test", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SERVICE_ROLE_KEY: "svc", RETENTION_SECRET: "s3" };
const JWT = "Bearer aaa.bbb.ccc";
const P = "11111111-1111-4111-8111-111111111111/rx.png";
const req = (path, auth) => new Request("https://f.test/rx-file?path=" + encodeURIComponent(path), { headers: auth ? { authorization: auth } : {} });
const mk = (allow, ct = "image/png") => { const calls = []; const f = async (url, o = {}) => { calls.push({ url, o });
  if (url.endsWith("/rpc/rx_authorize_read")) return new Response(JSON.stringify(allow), { status: 200 });
  return new Response("BYTES", { status: 200, headers: { "content-type": ct } }); }; f.calls = calls; return f; };

test("rx-file: no token or bad path is refused before any backend call", async () => {
  const f = mk(true);
  assert.equal((await file.handle(req(P, null), env, f)).status, 401);
  assert.equal((await file.handle(req("../../etc/passwd", JWT), env, f)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("rx-file: database denial returns 404 and never touches storage with the service key", async () => {
  const f = mk(false);
  const r = await file.handle(req(P, JWT), env, f);
  assert.equal(r.status, 404);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith("/rpc/rx_authorize_read"));
  assert.equal(f.calls[0].o.headers.authorization, JWT);
});
test("rx-file: allowed read streams with no-store, nosniff, attachment; service key only on the storage call", async () => {
  const f = mk(true);
  const r = await file.handle(req(P, JWT), env, f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-disposition"), "attachment");
  assert.equal(await r.text(), "BYTES");
  assert.ok(!JSON.stringify(f.calls[0].o).includes("svc"));
  assert.ok(f.calls[1].o.headers.authorization.includes("svc"));
});
test("rx-file: unexpected stored content type is refused", async () => {
  assert.equal((await file.handle(req(P, JWT), env, mk(true, "text/html"))).status, 415);
});
test("rx-retention: wrong or missing secret is refused with no backend call", async () => {
  const f = mk(true);
  assert.equal((await ret.handle(new Request("https://f.test/r"), env, f)).status, 401);
  assert.equal((await ret.handle(new Request("https://f.test/r", { headers: { "x-retention-secret": "nope" } }), env, f)).status, 401);
  assert.equal(f.calls.length, 0);
});
test("rx-retention: deletes then verifies each file is gone; a file that survives is reported as failed", async () => {
  const gone = new Set();
  const f = async (url, o = {}) => {
    if (url.endsWith("/rpc/rx_retention_candidates")) return new Response(JSON.stringify(["a/1.png", "b/2.png"]));
    if (url.includes("/rx_access_log")) return new Response("", { status: 201 });
    if (o.method === "DELETE") { if (url.endsWith("a/1.png")) gone.add(url); return new Response("{}", { status: 200 }); }
    return new Response("", { status: gone.has(url) ? 404 : 200 });
  };
  const r = await ret.handle(new Request("https://f.test/r", { headers: { "x-retention-secret": "s3" } }), env, f);
  const j = await r.json();
  assert.equal(r.status, 207);
  assert.equal(j.deleted, 1);
  assert.deepEqual(j.failed, ["b/2.png"]);
});
