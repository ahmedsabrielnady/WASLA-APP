// wasla-test ONLY. Telegram bot webhook: a provider sends "/start CODE" (or just the code) and the chat gets linked.
// Telegram proves itself with the secret token header set in setWebhook; we compare it to the database-held secret.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}
function same(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function say(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }) });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const secret = String(await rpc("telegram_hook_secret", {}));
    const body = await req.json();
    // Admin calls come from the database (pg_net) with the shared hook header: register the webhook or check the bot.
    if (body?.action && secret && same(req.headers.get("x-wasla-hook") ?? "", secret)) {
      if (body.action === "check") { const r = await (await fetch(`https://api.telegram.org/bot${BOT}/getMe`)).json(); return Response.json({ ok: r.ok === true, username: r.result?.username ?? null, has_token: BOT.length > 0, token_len: BOT.length, desc: r.description ?? null }); }
      if (body.action === "setup" && /^https:\/\//.test(String(body.url))) {
        const r = await (await fetch(`https://api.telegram.org/bot${BOT}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: body.url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }) })).json();
        return Response.json({ ok: r.ok === true, description: r.description ?? null });
      }
      return new Response("bad action", { status: 400 });
    }
    if (!secret || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return new Response("forbidden", { status: 403 });
    const update = body;
    const msg = update?.message;
    const chat = Number(msg?.chat?.id);
    if (!msg?.text || !Number.isFinite(chat) || msg.chat?.type !== "private") return new Response("ok");
    const m = String(msg.text).trim().match(/^(?:\/start\s+)?([A-Za-z0-9]{8})$/);
    if (!m) { await say(chat, "أهلا بيك في وصلة. افتح لوحة مقدم الخدمة واضغط ربط تليجرام، وابعتلي الكود اللي هيظهر."); return new Response("ok"); }
    const linked = await rpc("telegram_link_chat", { p_code: m[1], p_chat: chat });
    await say(chat, linked ? "تم ربط تليجرام. هيوصلك تنبيه هنا لما يتسند لك طلب جديد." : "الكود غير صحيح أو انتهت صلاحيته. اطلب كود جديد من لوحة مقدم الخدمة.");
  } catch (_e) { /* never echo errors to Telegram */ }
  return new Response("ok");
});
