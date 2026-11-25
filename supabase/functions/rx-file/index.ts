// DEV ARTIFACT, not deployed anywhere. Prescription file proxy: every read is authorized and logged by the database, then streamed with no-store.
// Requires draft 0800 and draft 0801 (which removes direct storage reads and therefore direct signed-URL issuance for users).
// Env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY (service key is only used server-side for the storage read).
const PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;
const MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const out = (status, body, extra) => new Response(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(extra || {}) } });
export async function handle(req, env, f) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) return out(401, "unauthorized");
  const path = new URL(req.url).searchParams.get("path") || "";
  if (!PATH_RE.test(path)) return out(400, "bad path");
  const r = await f(env.SUPABASE_URL + "/rest/v1/rpc/rx_authorize_read", { method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ p_name: path }) });
  if (!r.ok || (await r.json()) !== true) return out(404, "not found");
  const s = await f(env.SUPABASE_URL + "/storage/v1/object/prescriptions/" + path, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } });
  if (!s.ok) return out(404, "not found");
  const ct = (s.headers.get("content-type") || "").split(";")[0];
  if (!MIMES.includes(ct)) return out(415, "unsupported type");
  return out(200, s.body, { "Content-Type": ct, "Content-Disposition": "attachment" });
}
if (typeof Deno !== "undefined") Deno.serve((req) => handle(req, Deno.env.toObject(), fetch));
