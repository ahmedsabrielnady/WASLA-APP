// Opt-in Web Push (client half only). Nothing here sends a push. It stays off until CONFIG.pushPublicKey is set,
// which needs a sender and VAPID keys that do not exist yet. The device is registered only after the user taps the button.
export const PUSH_GENERIC_TITLE = "وصلة";
export const PUSH_GENERIC_BODY = "عندك إشعار جديد في وصلة";

export function pushConfigured(publicKey) {
  return typeof publicKey === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(publicKey);
}

export function pushSupported(env = globalThis) {
  return Boolean(env?.navigator?.serviceWorker && env?.PushManager && env?.Notification);
}

export function urlBase64ToUint8Array(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Call only from a click handler (user gesture). Returns { ok, reason }.
export async function enablePush({ publicKey, registration, requestPermission, subscribeRpc }) {
  if (!pushConfigured(publicKey)) return { ok: false, reason: "not-configured" };
  const permission = await requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const json = subscription.toJSON();
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) {
    await subscription.unsubscribe();
    return { ok: false, reason: "bad-subscription" };
  }
  try {
    await subscribeRpc(json.endpoint, json.keys.p256dh, json.keys.auth);
  } catch (error) {
    await subscription.unsubscribe();
    return { ok: false, reason: "server-refused" };
  }
  return { ok: true, reason: "" };
}

export async function disablePush({ registration, unsubscribeRpc }) {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { ok: true, removed: false };
  await unsubscribeRpc(subscription.endpoint);
  await subscription.unsubscribe();
  return { ok: true, removed: true };
}
