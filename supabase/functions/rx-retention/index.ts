// DEV ARTIFACT, not deployed anywhere. Deletes prescription files of requests expired for more than 7 days through the real Storage API, then verifies each deletion.
// Trigger it from a scheduler you control (for example Supabase cron) with the x-retention-secret header. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RETENTION_SECRET.
export async function handle(req, env, f) {
  if (!env.RETENTION_SECRET || req.headers.get("x-retention-secret") !== env.RETENTION_SECRET) return new Response("unauthorized", { status: 401 });
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" };
  const c = await f(env.SUPABASE_URL + "/rest/v1/rpc/rx_retention_candidates", { method: "POST", headers: h, body: "{}" });
  if (!c.ok) return new Response("candidates failed", { status: 502 });
  const names = await c.json();
  const res = { deleted: 0, failed: [] };
  for (const name of names) {
    const url = env.SUPABASE_URL + "/storage/v1/object/prescriptions/" + name;
    const d = await f(url, { method: "DELETE", headers: h });
    const g = d.ok ? await f(url, { headers: h }) : null;
    if (d.ok && g && g.status >= 400) { res.deleted++; await f(env.SUPABASE_URL + "/rest/v1/rx_access_log", { method: "POST", headers: h, body: JSON.stringify({ path: name, role: "retention", ok: true }) }); }
    else res.failed.push(name);
  }
  return new Response(JSON.stringify(res), { status: res.failed.length ? 207 : 200, headers: { "content-type": "application/json", "Cache-Control": "no-store" } });
}
if (typeof Deno !== "undefined") Deno.serve((req) => handle(req, Deno.env.toObject(), fetch));
