// wasla-test ONLY. Sends one Telegram alert when a provider gets a new order.
// Called by the database (pg_net) with the shared hook header. Only the notification id arrives.
// Nothing about the customer or the order is sent to Telegram: the message is a fixed sentence.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SITE = Deno.env.get("WASLA_SITE_URL") ?? "";

async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}
function same(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  try {
    const secret = String(await (await fetch(`${SB}/rest/v1/rpc/telegram_hook_secret`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: "{}" })).json());
    if (!secret || !same(req.headers.get("x-wasla-hook") ?? "", secret)) return new Response("forbidden", { status: 403 });
    if (!BOT) return new Response("no bot", { status: 503 });
    const { notification_id } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(notification_id))) return new Response("bad id", { status: 400 });
    const chat = await rpc("telegram_chat_for_alert", { p_notification: notification_id });
    if (!chat) return new Response("no chat", { status: 200 });
    const text = "طلب جديد اتسند لك على وصلة. افتح لوحة مقدم الخدمة." + (SITE ? `\n${SITE}` : "");
    const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
    return new Response(r.ok ? "sent" : `telegram ${r.status}`, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
});
