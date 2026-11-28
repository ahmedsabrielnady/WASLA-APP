import { CONFIG } from "./config.js";
import { validateRoadmapUpdate, patientFileDeniedMessage } from "./domain.js";
import { normalizeEgyptianPhone, resolveAuthIdentifier, toWaslaAuthEmail } from "./auth-utils.js";
import { fetchTextWithTimeout } from "./network.js";

const SESSION_KEY = "wasla.auth.session.v1";
const PENDING_CONSENT_KEY = "wasla.pending-consent.v1";
const OAUTH_VERIFIER_KEY = "wasla.auth.google-pkce-verifier.v1";
const HEALTH_CONSENT_VERSION = "draft-2026-11-24.2";
const PRODUCT_SELECT = "id,name,price_egp,discount_price_egp,stock,category,merchant_id,aisle,unit";
const POLICY_VERSION = "draft-2026-11-24.2";
const API_ROOT = CONFIG.supabaseUrl.replace(/\/$/, "");

let refreshInFlight = null;

function assertLiveWritesAllowed(action) {
  if (CONFIG.isPublicPreview) {
    throw new Error(`هذه نسخة معاينة؛ ${action} متوقف حتى لا نكتب بيانات تجريبية في قاعدة البيانات الحية.`);
  }
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  const normalized = {
    ...session,
    expires_at: session.expires_at
      ?? Math.floor(Date.now() / 1000) + Number(session.expires_in ?? 3600)
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

const PENDING_CLEANUP_KEY = "wasla.pending-file-cleanup.v1";

function readPendingCleanups() {
  try { const list = JSON.parse(localStorage.getItem(PENDING_CLEANUP_KEY) || "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
}

function writePendingCleanups(list) {
  try { if (list.length) localStorage.setItem(PENDING_CLEANUP_KEY, JSON.stringify(list.slice(-20))); else localStorage.removeItem(PENDING_CLEANUP_KEY); } catch { /* storage unavailable */ }
}

// Deletes through the Storage API, then verifies by LISTING the folder (a POST, never served from a CDN cache).
// Returns true only when the listing succeeds and the file is not in it.
async function removeUploadedPrescriptionFile(token, path) {
  const headers = { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${token}` };
  const [folder, name] = String(path).split("/");
  try {
    await fetch(`${API_ROOT}/storage/v1/object/prescriptions/${path}`, { method: "DELETE", headers });
    const listed = await fetch(`${API_ROOT}/storage/v1/object/list/prescriptions`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: folder, limit: 100 }) });
    if (!listed.ok) return false;
    const items = await listed.json();
    return Array.isArray(items) && !items.some((item) => item?.name === name);
  } catch {
    return false;
  }
}

async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    token = null,
    headers = {},
    cache = "no-store"
  } = options;

  const requestHeaders = {
    apikey: CONFIG.supabasePublishableKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/json",
    ...headers
  };

  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  let response;
  let raw;
  try {
    const result = await fetchTextWithTimeout(`${API_ROOT}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache
    });
    response = result.response;
    raw = result.text;
  } catch (error) {
    if (error?.code === "WASLA_REQUEST_TIMEOUT") {
      throw new Error("استغرق الاتصال بالخدمة وقتًا أطول من المتوقع. أعد المحاولة.");
    }
    throw new Error("تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم أعد المحاولة.");
  }
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error;
    if (response.status === 401) {
      throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    }
    if (response.status === 409) {
      throw new Error("البيانات مسجلة بالفعل.");
    }
    throw new Error(message || "تعذر تنفيذ العملية. حاول مرة أخرى.");
  }

  return data;
}

async function getValidSession() {
  let session = getStoredSession();
  if (!session) return null;

  const expiresAt = Number(session.expires_at ?? 0);
  if (expiresAt > Math.floor(Date.now() / 1000) + 90) return session;
  if (!session.refresh_token) {
    clearSession();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token }
    })
      .then((nextSession) => saveSession(nextSession))
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  session = await refreshInFlight;
  return session;
}

async function authRequest(path, body) {
  return request(path, { method: "POST", body });
}

export const authApi = {
  getSession: getStoredSession,

  async getAuthSettings() {
    return request("/auth/v1/settings");
  },

  async getUser() {
    const session = await getValidSession();
    if (!session?.access_token) return null;

    try {
      return await request("/auth/v1/user", { token: session.access_token });
    } catch (error) {
      if (String(error.message).includes("انتهت جلسة")) clearSession();
      throw error;
    }
  },

  async signIn(identifier, password) {
    const resolved = resolveAuthIdentifier(identifier);
    if (!resolved) throw new Error("أدخل رقم موبايل مصري صحيحًا أو بريدًا إلكترونيًا صحيحًا.");
    const email = toWaslaAuthEmail(identifier);
    if (!email) throw new Error("بيانات الدخول غير صحيحة.");
    const result = await authRequest("/auth/v1/token?grant_type=password", {
      email,
      password
    });
    saveSession(result);
    return result;
  },

  async signUp({ identifier, email, password, fullName, phone }) {
    assertLiveWritesAllowed("إنشاء الحسابات");
    // Keep the previous email + phone signup contract working for callers and existing tests.
    const signupIdentifier = identifier ?? email;
    const resolved = resolveAuthIdentifier(signupIdentifier);
    if (!resolved) throw new Error("أدخل رقم موبايل مصري صحيحًا أو بريدًا إلكترونيًا صحيحًا.");
    const phoneInput = resolved.type === "phone" ? signupIdentifier : phone;
    const normalizedPhone = phoneInput ? normalizeEgyptianPhone(phoneInput) : null;
    if (phoneInput && !normalizedPhone) throw new Error("رقم الموبايل يجب أن يكون رقمًا مصريًا صحيحًا.");
    const localPhone = normalizedPhone ? `0${normalizedPhone.slice(3)}` : "";
    const data = {
      full_name: String(fullName).trim(),
      ...(localPhone ? { phone: localPhone } : {}),
      terms_version: POLICY_VERSION,
      privacy_version: POLICY_VERSION,
      consent_accepted_at: new Date().toISOString()
    };
    const authEmail = toWaslaAuthEmail(signupIdentifier);
    if (!authEmail) throw new Error("بيانات التسجيل غير صحيحة.");
    const result = await authRequest("/auth/v1/signup", {
      email: authEmail,
      password,
      data
    });

    if (result?.access_token && result?.refresh_token) {
      saveSession(result);
    }
    return { ...result, identifier_type: resolved.type };
  },

  async signInWithGoogle() {
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
      throw new Error("المتصفح لا يدعم تسجيل Google الآمن. حدّث المتصفح.");
    }
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const verifier = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
    const redirectTo = window.location.origin + window.location.pathname + window.location.search;
    const query = new URLSearchParams({
      provider: "google",
      redirect_to: redirectTo,
      code_challenge: challenge,
      code_challenge_method: "s256"
    });
    window.location.assign(`${API_ROOT}/auth/v1/authorize?${query}`);
  },

  async linkGoogle() {
    // Signed-in users attach their own Google account. Supabase requires manual linking to be enabled
    // and refuses to attach a Google identity that already belongs to another user.
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
      throw new Error("المتصفح لا يدعم ربط Google الآمن. حدّث المتصفح.");
    }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const verifier = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
    const query = new URLSearchParams({
      provider: "google",
      redirect_to: window.location.origin + window.location.pathname + window.location.search,
      code_challenge: challenge,
      code_challenge_method: "s256",
      skip_http_redirect: "true"
    });
    let result;
    try {
      result = await request(`/auth/v1/user/identities/authorize?${query}`, { token: session.access_token });
    } catch (error) {
      sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
      throw error;
    }
    if (!result?.url) {
      sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
      throw new Error("تعذر بدء ربط Google. تأكد أن الربط مفعّل ثم أعد المحاولة.");
    }
    window.location.assign(result.url);
  },

  async acceptOAuthFromUrl() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) {
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (error) {
        url.searchParams.delete("error");
        url.searchParams.delete("error_description");
        url.searchParams.delete("error_code");
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        return { error };
      }
      return { ok: false };
    }

    const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
    if (!verifier) throw new Error("انتهت محاولة تسجيل Google. ابدأ تسجيل الدخول من جديد.");
    const result = await authRequest("/auth/v1/token?grant_type=pkce", {
      auth_code: code,
      code_verifier: verifier
    });
    saveSession(result);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    return { ok: true };
  },

  acceptSignupFromUrl() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") !== "signup" || !hash.get("access_token") || !hash.get("refresh_token")) return false;
    saveSession({
      access_token: hash.get("access_token"),
      refresh_token: hash.get("refresh_token"),
      token_type: hash.get("token_type") || "bearer",
      expires_in: Number(hash.get("expires_in") || 3600)
    });
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return true;
  },

  acceptRecoveryFromUrl() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") !== "recovery" || !hash.get("access_token") || !hash.get("refresh_token")) return false;
    saveSession({
      access_token: hash.get("access_token"),
      refresh_token: hash.get("refresh_token"),
      token_type: hash.get("token_type") || "bearer",
      expires_in: Number(hash.get("expires_in") || 3600)
    });
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return true;
  },

  async requestPasswordReset(email) {
    assertLiveWritesAllowed("استعادة الحسابات");
    const redirectTo = window.location.origin + window.location.pathname;
    return request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      body: { email: String(email).trim() }
    });
  },

  async updatePassword(password) {
    assertLiveWritesAllowed("تغيير كلمات المرور");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.");
    return request("/auth/v1/user", {
      method: "PUT",
      token: session.access_token,
      body: { password }
    });
  },

  async signOut() {
    const session = await getValidSession();
    try {
      if (session?.access_token) {
        await request("/auth/v1/logout", {
          method: "POST",
          token: session.access_token
        });
      }
    } finally {
      clearSession();
    }
  }
};

// A datetime-local value has no zone. The service area is Cairo time, so read it as Cairo wall-clock time
// whatever the browser zone is. Egypt uses daylight saving, so the offset is computed for that date.
export function resolveCairoLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!m) return { status: "invalid", date: new Date(NaN) };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCFullYear() !== y || new Date(wall).getUTCMonth() !== mo - 1 || new Date(wall).getUTCDate() !== d || h > 23 || mi > 59) return { status: "invalid", date: new Date(NaN) };
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const wallOf = (t) => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
  // Cairo is UTC+2 or UTC+3. A candidate instant is valid only if it shows exactly the typed wall time in Cairo.
  const hits = [3, 2].map((off) => wall - off * 3600000).filter((t) => wallOf(t) === wall);
  if (hits.length === 0) return { status: "gap", date: new Date(NaN) };
  if (hits.length === 2) return { status: "ambiguous", date: new Date(NaN) };
  return { status: "ok", date: new Date(hits[0]) };
}
// Kept for callers that only need the instant: anything that is not exactly one valid instant is an invalid date.
export function cairoLocalToDate(value) { return resolveCairoLocal(value).date; }

export function cairoLocalProblem(value) {
  const r = resolveCairoLocal(value);
  if (r.status === "gap") return "الوقت ده مش موجود بسبب تغيير الساعة. اختار وقت تاني.";
  if (r.status === "ambiguous") return "الوقت ده بيتكرر بسبب تغيير الساعة. اختار وقت تاني.";
  if (r.status === "invalid") return "الموعد غير صالح.";
  const ms = r.date.getTime() - Date.now();
  if (ms < 3600000) return "الموعد المقترح لازم يكون بعد ساعة على الأقل.";
  if (ms > 60 * 86400000) return "الموعد المقترح لازم يكون خلال ٦٠ يوم.";
  return "";
}

const DELIVERY_FEE_COLUMNS = ",customer_fee_egp,list_fee_egp,promo_applied,courier_pay_egp,order_id,area,zone";

export const dataApi = {
  async getProfile(userId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    const query = new URLSearchParams({
      select: "id,full_name,phone,role",
      id: `eq.${userId}`,
      limit: "1"
    });

    const rows = await request(`/rest/v1/profiles?${query}`, {
      token: session.access_token
    });
    return Array.isArray(rows) ? rows[0] ?? null : null;
  },

  async adoptGoogleName(userId, fullName) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const query = new URLSearchParams({
      id: `eq.${userId}`,
      or: "(full_name.is.null,full_name.eq.,full_name.eq.مستخدم)",
      select: "id,full_name"
    });
    const rows = await request(`/rest/v1/profiles?${query}`, {
      method: "PATCH",
      token: session.access_token,
      headers: { Prefer: "return=representation" },
      body: { full_name: String(fullName).trim() }
    });
    return Array.isArray(rows) ? rows[0] ?? null : null;
  },

  async getRoadmap() {
    const session = await getValidSession();
    const query = new URLSearchParams({
      select: "id,area,title,description,weight,status,progress_percent,test_status,sort_order,public_visible,updated_at",
      public_visible: "eq.true",
      order: "sort_order.asc"
    });
    return request(`/rest/v1/roadmap_milestones?${query}`, {
      token: session?.access_token ?? null
    });
  },

  async getRoadmapAudit(limit = 10) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل دخول المؤسس لعرض سجل التغييرات.");

    const query = new URLSearchParams({
      select: "id,milestone_id,milestone_title_snapshot,actor_id,old_status,new_status,old_progress_percent,new_progress_percent,old_test_status,new_test_status,created_at",
      order: "created_at.desc",
      limit: String(Math.max(1, Math.min(25, Number(limit) || 10)))
    });
    return request(`/rest/v1/roadmap_milestone_audit?${query}`, {
      token: session.access_token
    });
  },

  async updateRoadmapMilestone(id, { status, progressPercent, testStatus }) {
    assertLiveWritesAllowed("تحديث خطة الإنجاز");
    const validation = validateRoadmapUpdate(status, progressPercent, testStatus);
    if (!validation.valid) throw new Error(validation.message);

    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل دخول المؤسس أولًا.");

    const query = new URLSearchParams({ id: `eq.${String(id)}` });
    return request(`/rest/v1/roadmap_milestones?${query}`, {
      method: "PATCH",
      token: session.access_token,
      headers: { Prefer: "return=minimal" },
      body: {
        status,
        progress_percent: Number(progressPercent),
        test_status: testStatus
      }
    });
  },

  async getServices() {
    const query = new URLSearchParams({
      select: "id,sector,name,price_egp,active,public_orderable",
      active: "eq.true",
      order: "sector.asc,name.asc"
    });
    return request(`/rest/v1/service_items?${query}`);
  },

  async getOffers() {
    const query = new URLSearchParams({
      select: "id,text,sort_order,sector",
      active: "eq.true",
      order: "sort_order.asc,id.asc"
    });
    return request(`/rest/v1/offers?${query}`);
  },

  async getOperationsOffers() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const query = new URLSearchParams({ select: "id,text,sort_order,sector,active", order: "sort_order.asc,id.asc" });
    return request(`/rest/v1/offers?${query}`, { token: session.access_token });
  },

  async adminSaveOffer({ id = null, text, sector = "", active = true, sortOrder = 0 }) {
    assertLiveWritesAllowed("إدارة إعلانات البانر");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/admin_save_offer", {
      method: "POST",
      token: session.access_token,
      body: { p_id: id ? Number(id) : null, p_text: text, p_sector: sector || null, p_active: Boolean(active), p_sort: Number(sortOrder) || 0 }
    });
  },

  async getMyOrderTracking(orderId) {
    if (!orderId) throw new Error("الطلب غير محدد.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لمتابعة طلباتك.");
    const rows = await request("/rest/v1/rpc/my_order_tracking", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId }
    });
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  },

  async getMyOrders(userId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض طلباتك.");

    const base = "id,ref,sector,status,price_egp,deposit_egp,deposit_paid,created_at,scheduled_at,item_id,product_id,quantity";
    const build = (select) => new URLSearchParams({
      select,
      customer_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "30"
    });

    // Optional columns exist only after the draft migrations (quote acceptance, product category
    // snapshot). Older schemas drop them one at a time and keep the base columns.
    const optional = { quote: true, category: true, preferred: true };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const select = [base, optional.quote ? "quote_price_egp,quote_version" : "", optional.category ? "product_category" : "", optional.preferred ? "preferred_at" : ""].filter(Boolean).join(",");
      try {
        return await request(`/rest/v1/orders?${build(select)}`, { token: session.access_token });
      } catch (error) {
        const message = String(error?.message);
        if (optional.preferred && /preferred_at/.test(message)) optional.preferred = false;
        else if (optional.category && /product_category/.test(message)) optional.category = false;
        else if (optional.quote && /quote_price_egp|quote_version/.test(message)) optional.quote = false;
        else throw error;
      }
    }
    return request(`/rest/v1/orders?${build(base)}`, { token: session.access_token });
  },

  async getOperationsOrders() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض لوحة التشغيل.");

    const build = (select) => new URLSearchParams({ select, order: "created_at.desc", limit: "50" });
    const base = "id,ref,sector,status,price_egp,deposit_egp,deposit_paid,created_at,updated_at,scheduled_at,address,provider_id,item_id,product_id,quantity";
    try {
      try {
        return await request(`/rest/v1/orders?${build(base + ",preferred_at,quote_price_egp")}`, { token: session.access_token });
      } catch (quoteError) {
        if (!/quote_price_egp/.test(String(quoteError?.message))) throw quoteError;
      }
      return await request(`/rest/v1/orders?${build(base + ",preferred_at")}`, { token: session.access_token });
    } catch (error) {
      if (!/preferred_at/.test(String(error?.message))) throw error;
      return request(`/rest/v1/orders?${build(base)}`, { token: session.access_token });
    }
  },

  // Requests to change or cancel a confirmed nursing order. A request is not a change: only 'applied' means staff did it.
  async getMyNotifications() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    try {
      return await request(`/rest/v1/notifications?${new URLSearchParams({ select: "id,kind,ref_id,created_at,read_at", order: "created_at.desc", limit: "20" })}`, { token: session.access_token });
    } catch { return []; }
  },

  // Web Push opt-in (draft 3000). Stores only the browser endpoint and keys for the signed-in user. Nothing sends.
  async pushSubscribe(endpoint, p256dh, auth) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولاً.");
    return request("/rest/v1/rpc/push_subscribe", { method: "POST", token: session.access_token, body: { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth } });
  },

  async pushUnsubscribe(endpoint) {
    const session = await getValidSession();
    if (!session?.access_token) return 0;
    return request("/rest/v1/rpc/push_unsubscribe", { method: "POST", token: session.access_token, body: { p_endpoint: endpoint } });
  },

  // Telegram alert link (TEST). The code is typed to the bot by the provider; the bot never receives anything from the site.
  async telegramLinkCode() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولاً.");
    return request("/rest/v1/rpc/provider_telegram_link_code", { method: "POST", token: session.access_token, body: {} });
  },

  async telegramStatus() {
    const session = await getValidSession();
    if (!session?.access_token) return false;
    try { return (await request("/rest/v1/rpc/provider_telegram_status", { method: "POST", token: session.access_token, body: {} })) === true; } catch { return false; }
  },

  async telegramUnlink() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    return request("/rest/v1/rpc/provider_telegram_unlink", { method: "POST", token: session.access_token, body: {} });
  },

  async markNotificationsRead() {
    const session = await getValidSession();
    if (!session?.access_token) return 0;
    return request("/rest/v1/rpc/mark_notifications_read", { method: "POST", token: session.access_token, body: {} });
  },

  async getMyChangeRequests() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    try {
      return await request(`/rest/v1/order_change_requests?${new URLSearchParams({ select: "id,order_id,kind,status,note,created_at", order: "created_at.desc", limit: "100" })}`, { token: session.access_token });
    } catch { return []; }
  },

  async requestOrderChange({ orderId, kind, note }) {
    assertLiveWritesAllowed("طلب تعديل أو إلغاء");
    if (!["change_time", "cancel"].includes(kind)) throw new Error("نوع الطلب غير صالح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/customer_request_order_change", { method: "POST", token: session.access_token, body: { p_order: orderId, p_kind: kind, p_note: String(note || "").trim().slice(0, 300) || null } });
  },

  async resolveOrderChange({ requestId, status }) {
    assertLiveWritesAllowed("مراجعة طلب التعديل");
    if (!["applied", "declined"].includes(status)) throw new Error("حالة غير صالحة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    await request("/rest/v1/rpc/staff_resolve_order_change", { method: "POST", token: session.access_token, body: { p_request: requestId, p_status: status } });
  },

  // Staff fix the agreed visit time. The server only accepts open nursing orders; the time is read as Cairo wall-clock time.
  async staffScheduleOrder({ orderId, value }) {
    assertLiveWritesAllowed("تحديد موعد الزيارة");
    const r = resolveCairoLocal(value);
    if (r.status === "gap") throw new Error("الوقت ده مش موجود بسبب تغيير الساعة. اختار وقت تاني.");
    if (r.status === "ambiguous") throw new Error("الوقت ده بيتكرر بسبب تغيير الساعة. اختار وقت تاني.");
    if (r.status !== "ok") throw new Error("الموعد غير صالح.");
    if (r.date.getTime() < Date.now() || r.date.getTime() > Date.now() + 60 * 86400000) throw new Error("الموعد لازم يكون في المستقبل وخلال ٦٠ يوم.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    await request("/rest/v1/rpc/staff_schedule_order", { method: "POST", token: session.access_token, body: { p_order: orderId, p_at: r.date.toISOString() } });
  },

  async getOperationsProviders() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض مقدمي الخدمة.");

    const build = (select) => new URLSearchParams({ select, order: "created_at.desc", limit: "100" });
    const base = "id,kind,display_name,specialty,area,approved,active,is_test,created_at";
    try {
      return await request(`/rest/v1/providers?${build(base + ",nursing_credential_verified")}`, { token: session.access_token });
    } catch (error) {
      // Before the nursing credential draft is applied nobody is credentialed.
      if (!/nursing_credential_verified/.test(String(error?.message))) throw error;
      const rows = await request(`/rest/v1/providers?${build(base)}`, { token: session.access_token });
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, nursing_credential_verified: false })) : rows;
    }
  },

  async setNursingCredential(providerId, verified) {
    assertLiveWritesAllowed("اعتماد التمريض");
    if (!providerId) throw new Error("اختر مقدم الخدمة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/staff_set_nursing_credential", {
      method: "POST", token: session.access_token,
      body: { p_provider: providerId, p_verified: verified === true }
    });
  },

  async getOperationsServices() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض قائمة الخدمات.");

    const query = new URLSearchParams({
      select: "id,sector,name,price_egp,active,public_orderable",
      order: "sector.asc,name.asc",
      limit: "200"
    });

    return request(`/rest/v1/service_items?${query}`, {
      token: session.access_token
    });
  },

  async getOperationsCoverage() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض تغطية مقدمي الخدمة.");

    const query = new URLSearchParams({
      select: "id,provider_id,service_item_id,active,created_at",
      order: "created_at.desc",
      limit: "500"
    });

    return request(`/rest/v1/provider_service_coverage?${query}`, {
      token: session.access_token
    });
  },

  async adminSetProviderServiceCoverage(providerId, serviceItemId, active = true) {
    assertLiveWritesAllowed("إدارة تغطية مقدمي الخدمة");
    const numericServiceId = Number(serviceItemId);
    if (!providerId || !Number.isInteger(numericServiceId) || numericServiceId <= 0) {
      throw new Error("حدد مقدم الخدمة والخدمة أولًا.");
    }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/admin_set_provider_service_coverage", {
      method: "POST",
      token: session.access_token,
      body: {
        p_provider_id: providerId,
        p_service_item_id: numericServiceId,
        p_active: Boolean(active)
      }
    });
  },

  async adminUpdateServicePrice(itemId, price) {
    assertLiveWritesAllowed("تعديل أسعار الخدمات");
    const numericId = Number(itemId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error("الخدمة غير محددة.");
    }
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10000000)) {
      throw new Error("السعر غير صالح.");
    }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/admin_update_service_item_price", {
      method: "POST",
      token: session.access_token,
      body: { p_item_id: numericId, p_price: price }
    });
  },

  async getProviderWorkspace() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض مساحة مقدم الخدمة.");

    const user = await request("/auth/v1/user", { token: session.access_token });
    if (!user?.id) throw new Error("تعذر التحقق من حساب مقدم الخدمة.");

    const providerQuery = new URLSearchParams({
      select: "id,kind,display_name,specialty,area,approved,active,is_test",
      user_id: `eq.${user.id}`,
      limit: "1"
    });
    const providers = await request(`/rest/v1/providers?${providerQuery}`, {
      token: session.access_token
    });
    const provider = Array.isArray(providers) ? providers[0] ?? null : null;
    if (!provider || !provider.approved || !provider.active || provider.is_test) {
      return { provider, orders: [] };
    }

    const orderQuery = new URLSearchParams({
      select: "id,ref,sector,status,price_egp,deposit_egp,created_at,updated_at,scheduled_at,address,notes,quantity,product_id,product_category",
      provider_id: `eq.${provider.id}`,
      order: "created_at.desc",
      limit: "100"
    });
    const orders = await request(`/rest/v1/orders?${orderQuery}`, {
      token: session.access_token
    });
    const list = Array.isArray(orders) ? orders : [];
    const ids = [...new Set(list.map((o) => o.product_id).filter((id) => id != null).map(Number).filter(Number.isInteger))];
    if (ids.length) {
      try {
        const names = await request(`/rest/v1/products?${new URLSearchParams({ select: "id,name", id: `in.(${ids.join(",")})` })}`, { token: session.access_token });
        const byId = new Map((Array.isArray(names) ? names : []).map((row) => [String(row.id), row.name]));
        list.forEach((o) => { if (o.product_id != null) o.product_name = byId.get(String(o.product_id)) || null; });
      } catch { /* the order list still works without product names */ }
    }
    return { provider, orders: list };
  },

  async providerSetOrderStatus(orderId, status, note = null) {
    assertLiveWritesAllowed("تحديث حالة طلب مقدم الخدمة");
    if (!orderId || !["in_progress", "done"].includes(status)) {
      throw new Error("تحديث الحالة المطلوبة غير صالح.");
    }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/provider_set_order_status_v2", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_to: status, p_note: note }
    });
  },

  async getCrmMetrics() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض CRM.");
    const rows = await request("/rest/v1/crm_dashboard_metrics?select=*", {
      token: session.access_token
    });
    return Array.isArray(rows) ? rows[0] ?? null : null;
  },

  async getCrmCustomers() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض العملاء.");
    const query = new URLSearchParams({
      select: "id,full_name,phone,created_at",
      role: "eq.customer",
      order: "created_at.desc",
      limit: "100"
    });
    return request(`/rest/v1/profiles?${query}`, { token: session.access_token });
  },

  async getCrmLeads() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض العملاء المحتملين.");
    const query = new URLSearchParams({ select: "*", order: "created_at.desc", limit: "100" });
    return request(`/rest/v1/crm_leads?${query}`, { token: session.access_token });
  },

  async getCrmTasks() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض المهام.");
    const query = new URLSearchParams({
      select: "*",
      status: "not.in.(done,cancelled)",
      order: "due_at.asc.nullslast,created_at.desc",
      limit: "100"
    });
    return request(`/rest/v1/crm_tasks?${query}`, { token: session.access_token });
  },

  async getCrmTickets() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض التذاكر.");
    const query = new URLSearchParams({ select: "*", order: "opened_at.desc", limit: "100" });
    return request(`/rest/v1/crm_tickets?${query}`, { token: session.access_token });
  },

  async getCrmCustomer360(customerId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض ملف العميل.");
    return request("/rest/v1/rpc/crm_customer_360", {
      method: "POST",
      token: session.access_token,
      body: { p_customer: customerId }
    });
  },

  async createCrmLead(values) {
    assertLiveWritesAllowed("إضافة العملاء المحتملين");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/crm_leads", {
      method: "POST",
      token: session.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        full_name: String(values.full_name || "").trim(),
        phone: String(values.phone || "").trim(),
        source: values.source || "manual",
        sector_interest: String(values.sector_interest || "").trim() || null,
        priority: Number(values.priority || 2),
        owner_id: session.user?.id || null,
        next_follow_up_at: values.next_follow_up_at || null
      }
    });
  },

  async updateCrmLead(leadId, status) {
    assertLiveWritesAllowed("تحديث العملاء المحتملين");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const query = new URLSearchParams({ id: `eq.${leadId}` });
    return request(`/rest/v1/crm_leads?${query}`, {
      method: "PATCH",
      token: session.access_token,
      headers: { Prefer: "return=minimal" },
      body: { status }
    });
  },

  async createCrmTask(values) {
    assertLiveWritesAllowed("إنشاء مهام CRM");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/crm_tasks", {
      method: "POST",
      token: session.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        title: String(values.title || "").trim(),
        customer_id: values.customer_id || null,
        kind: values.kind || "call_customer",
        priority: Number(values.priority || 2),
        assignee_id: session.user?.id || null,
        due_at: values.due_at ? new Date(values.due_at).toISOString() : null
      }
    });
  },

  async completeCrmTask(taskId, outcome = "") {
    assertLiveWritesAllowed("إغلاق مهام CRM");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const query = new URLSearchParams({ id: `eq.${taskId}` });
    return request(`/rest/v1/crm_tasks?${query}`, {
      method: "PATCH",
      token: session.access_token,
      headers: { Prefer: "return=minimal" },
      body: { status: "done", completed_at: new Date().toISOString(), outcome: outcome || null }
    });
  },

  async createCrmInteraction(values) {
    assertLiveWritesAllowed("تسجيل تواصل CRM");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/crm_interactions", {
      method: "POST",
      token: session.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        customer_id: values.customer_id || null,
        lead_id: values.lead_id || null,
        kind: values.kind || "note",
        subject: String(values.subject || "").trim() || null,
        body: String(values.body || "").trim() || null,
        actor_id: session.user?.id
      }
    });
  },

  async createCrmTicket(values) {
    assertLiveWritesAllowed("فتح تذاكر الدعم");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/crm_create_ticket", {
      method: "POST",
      token: session.access_token,
      body: {
        p_customer: values.customer_id,
        p_order: values.order_id || null,
        p_sector: values.sector || null,
        p_kind: values.kind || "inquiry",
        p_priority: Number(values.priority || 2),
        p_description: String(values.description || "").trim()
      }
    });
  },

  async updateCrmTicket(ticketId, status, resolution = "", note = "") {
    assertLiveWritesAllowed("تحديث تذاكر الدعم");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/crm_update_ticket", {
      method: "POST",
      token: session.access_token,
      body: {
        p_ticket: ticketId,
        p_to_status: status,
        p_assignee: null,
        p_resolution: resolution || null,
        p_note: note || null
      }
    });
  },

  async respondToQuote(orderId, version, accept) {
    assertLiveWritesAllowed(accept ? "الموافقة على عرض السعر" : "رفض عرض السعر");
    if (!orderId || !Number.isInteger(Number(version))) throw new Error("عرض السعر غير محدد.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request(`/rest/v1/rpc/${accept ? "accept_quote" : "decline_quote"}`, {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_version: Number(version) }
    });
  },

  async getMyDeliveries() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,ref,pickup_address,dropoff_address,what_to_deliver,status,created_at" + DELIVERY_FEE_COLUMNS,
      order: "created_at.desc",
      limit: "20"
    });
    try {
      try {
        return await request(`/rest/v1/delivery_requests?${query}`, { token: session.access_token });
      } catch (inner) {
        if (!/customer_fee_egp|promo_applied|courier_pay_egp|order_id|area|zone/.test(String(inner?.message))) throw inner;
        query.set("select", "id,ref,pickup_address,dropoff_address,what_to_deliver,status,created_at");
        return await request(`/rest/v1/delivery_requests?${query}`, { token: session.access_token });
      }
    } catch (error) {
      // Table absent (schema not migrated): hide the delivery section instead of failing the page.
      if (/delivery_requests/.test(String(error?.message))) return null;
      throw error;
    }
  },

  async getCourses(teacherId = null) {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,title,subject,description,lessons,mode,price_egp,seats,active,teacher_id,teacher:providers(display_name)",
      order: "created_at.desc", limit: "50"
    });
    if (teacherId) query.set("teacher_id", `eq.${teacherId}`); else query.set("active", "eq.true");
    try {
      return await request(`/rest/v1/courses?${query}`, { token: session.access_token });
    } catch (error) {
      if (/courses|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async getMyTutorProfile(teacherId) {
    const session = await getValidSession();
    if (!session?.access_token || !teacherId) return null;
    try {
      const rows = await request(`/rest/v1/tutor_profiles?${new URLSearchParams({ select: "headline,bio,subjects", teacher_id: `eq.${teacherId}`, limit: "1" })}`, { token: session.access_token });
      return rows?.[0] || null;
    } catch { return null; }
  },

  async teacherSaveProfile(values) {
    assertLiveWritesAllowed("حفظ الملف التعريفي");
    const headline = String(values?.headline || "").trim(), bio = String(values?.bio || "").trim();
    const subjects = String(values?.subjects || "").split(/[,،]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 40).slice(0, 8);
    if (headline.length < 3 || headline.length > 100) throw new Error("العنوان التعريفي من 3 إلى 100 حرف.");
    if (bio.length > 1000) throw new Error("النبذة حتى 1000 حرف.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/teacher_upsert_profile", { method: "POST", token: session.access_token, body: { p_headline: headline, p_bio: bio, p_subjects: subjects } });
  },

  async teacherCreateCourse(values) {
    assertLiveWritesAllowed("إضافة دورة");
    const title = String(values?.title || "").trim(), subject = String(values?.subject || "").trim(), description = String(values?.description || "").trim();
    const lessons = Number(values?.lessons), price = values?.price === "" || values?.price == null ? 0 : Number(values.price);
    if (title.length < 3 || title.length > 120) throw new Error("عنوان الدورة من 3 إلى 120 حرف.");
    if (subject.length < 2 || subject.length > 60) throw new Error("اكتب المادة.");
    if (description.length > 1000) throw new Error("الوصف حتى 1000 حرف.");
    if (!Number.isInteger(lessons) || lessons < 1 || lessons > 200) throw new Error("عدد الحصص من 1 إلى 200.");
    if (!Number.isInteger(price) || price < 0 || price > 20000) throw new Error("السعر من 0 إلى 20000.");
    if (!["online", "in_person"].includes(values?.mode)) throw new Error("اختر نوع الدورة.");
    const seats = values?.seats === "" || values?.seats == null ? 20 : Number(values.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 200) throw new Error("عدد المقاعد من 1 إلى 200.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/teacher_create_course", { method: "POST", token: session.access_token, body: { p_title: title, p_subject: subject, p_description: description, p_lessons: lessons, p_mode: values.mode, p_price: price, p_seats: seats } });
  },

  async getCourseEnrollments() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    try {
      return await request(`/rest/v1/course_enrollments?${new URLSearchParams({ select: "id,course_id,status,created_at", order: "created_at.desc", limit: "200" })}`, { token: session.access_token });
    } catch (error) {
      if (/course_enrollments|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async enrollInCourse(courseId) {
    assertLiveWritesAllowed("التسجيل في دورة");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(courseId || ""))) throw new Error("اختر الدورة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    try {
      return await request("/rest/v1/rpc/enroll_in_course", { method: "POST", token: session.access_token, body: { p_course: courseId } });
    } catch (error) {
      const text = String(error?.message || "");
      if (/course full/i.test(text)) throw new Error("الدورة مكتملة العدد.");
      if (/already enrolled/i.test(text)) throw new Error("أنت مسجل في الدورة دي بالفعل.");
      if (/course unavailable/i.test(text)) throw new Error("الدورة دي مش متاحة.");
      if (/own course/i.test(text)) throw new Error("لا يمكن التسجيل في دورتك.");
      if (/permission denied|schema cache|does not exist/i.test(text)) throw new Error("التسجيل في الدورات غير مفعل حاليًا.");
      throw error;
    }
  },

  async cancelCourseEnrollment(enrollmentId) {
    assertLiveWritesAllowed("إلغاء التسجيل في دورة");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(enrollmentId || ""))) throw new Error("تسجيل غير معروف.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/cancel_course_enrollment", { method: "POST", token: session.access_token, body: { p_enrollment: enrollmentId } });
  },

  async teacherSetCourseActive(courseId, active) {
    assertLiveWritesAllowed("تغيير ظهور الدورة");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(courseId || ""))) throw new Error("دورة غير معروفة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/teacher_set_course_active", { method: "POST", token: session.access_token, body: { p_course: courseId, p_active: active === true } });
  },

  async getSessions(teacherId = null) {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const base = "id,title,subject,starts_at,duration_min,mode,seats,price_egp,status,teacher_id,teacher:providers(display_name)";
    const build = (select) => {
      const query = new URLSearchParams({ select, order: "starts_at.asc", limit: "50" });
      if (teacherId) query.set("teacher_id", `eq.${teacherId}`); else query.set("status", "eq.open");
      return query;
    };
    try {
      try {
        return await request(`/rest/v1/tutor_sessions?${build(base + ",course_id,course:courses(title)")}`, { token: session.access_token });
      } catch (error) {
        // Before the course/session link draft is applied sessions are standalone.
        if (!/course/.test(String(error?.message))) throw error;
        const rows = await request(`/rest/v1/tutor_sessions?${build(base)}`, { token: session.access_token });
        return Array.isArray(rows) ? rows.map((row) => ({ ...row, course_id: null, course: null })) : rows;
      }
    } catch (error) {
      if (/tutor_sessions/.test(String(error?.message))) return null;
      throw error;
    }
  },

  async getMyEnrollments() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,session_id,status,created_at,session:tutor_sessions(title,subject,starts_at,mode)",
      status: "eq.booked", order: "created_at.desc", limit: "30"
    });
    try {
      return await request(`/rest/v1/session_enrollments?${query}`, { token: session.access_token });
    } catch (error) {
      if (/session_enrollments|tutor_sessions/.test(String(error?.message))) return null;
      throw error;
    }
  },

  async enrollInSession(sessionId) {
    assertLiveWritesAllowed("التسجيل في حصة");
    if (!sessionId) throw new Error("اختر الحصة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    try {
      return await request("/rest/v1/rpc/enroll_in_session", { method: "POST", token: session.access_token, body: { p_session: sessionId } });
    } catch (error) {
      if (/permission denied/i.test(String(error?.message))) throw new Error("التسجيل في الحصص غير مفعل حاليًا.");
      throw error;
    }
  },

  async cancelEnrollment(enrollmentId) {
    assertLiveWritesAllowed("إلغاء التسجيل");
    if (!enrollmentId) throw new Error("اختر التسجيل.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/cancel_enrollment", { method: "POST", token: session.access_token, body: { p_enrollment: enrollmentId } });
  },

  async getMyLabRequests() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({ select: "id,status,price_egp,result_text,result_file_path,created_at,updated_at,test:lab_tests(name,kind),provider:providers(display_name)", order: "created_at.desc", limit: "50" });
    try {
      return await request(`/rest/v1/lab_requests?${query}`, { token: session.access_token });
    } catch (error) {
      if (/lab_requests|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async labRpc(name, body, label) {
    assertLiveWritesAllowed(label);
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request(`/rest/v1/rpc/${name}`, { method: "POST", token: session.access_token, body });
  },

  requestLabTest(testId) { return this.labRpc("request_lab_test", { p_test: testId }, "طلب تحليل"); },
  cancelLabRequest(requestId) { return this.labRpc("patient_cancel_lab_request", { p_request: requestId }, "إلغاء طلب تحليل"); },
  labMarkSampleDone(requestId) { return this.labRpc("lab_set_request_status", { p_request: requestId, p_to: "sample_done" }, "تحديث حالة طلب"); },
  // Publishes a result FILE (pdf/jpeg/png, 5 MB) held in the private bucket 'lab-results', with an optional short note. Synthetic data only on the test project.
  async labPublishResultFile(requestId, file, text) {
    assertLiveWritesAllowed("نشر نتيجة");
    const types = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
    if (!file || !types[file.type] || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error("الملف PDF أو JPG أو PNG بحد أقصى 5 ميجا.");
    const note = String(text || "").trim();
    if (note && (note.length < 3 || note.length > 2000)) throw new Error("الملاحظة من 3 إلى 2000 حرف.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const token = session.access_token;
    const path = `${requestId}/res-${Date.now()}.${types[file.type]}`;
    const headers = { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${token}` };
    const upload = await fetch(`${API_ROOT}/storage/v1/object/lab-results/${path}`, { method: "POST", headers: { ...headers, "Content-Type": file.type }, body: file });
    if (!upload.ok) throw new Error("تعذر رفع الملف. تأكد إن العينة اتأخدت أولًا.");
    try {
      return await request("/rest/v1/rpc/lab_publish_result_file", { method: "POST", token, body: { p_request: requestId, p_path: path, p_text: note || null } });
    } catch (error) {
      let removed = false;
      try { removed = (await fetch(`${API_ROOT}/storage/v1/object/lab-results/${path}`, { method: "DELETE", headers })).ok; } catch { /* reported below */ }
      if (!removed) throw new Error("تعذر نشر النتيجة، وفشل حذف الملف المرفوع. الملف ظاهر للمعمل فقط ولم يُنشر للعميل.");
      throw error;
    }
  },

  async getLabResultFileUrl(path) {
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/.test(String(path || ""))) throw new Error("مسار الملف غير صالح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const response = await fetch(`${API_ROOT}/storage/v1/object/authenticated/lab-results/${path}`, { headers: { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("تعذر فتح ملف النتيجة.");
    return URL.createObjectURL(await response.blob());
  },

  labPublishResult(requestId, text) {
    const value = String(text || "").trim();
    if (value.length < 3 || value.length > 2000) throw new Error("النتيجة من 3 إلى 2000 حرف.");
    return this.labRpc("lab_publish_result", { p_request: requestId, p_text: value }, "نشر نتيجة");
  },

  async getLabTests() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({ select: "id,kind,name,price_egp,provider:providers(display_name)", active: "eq.true", order: "kind.asc,name.asc", limit: "100" });
    try {
      return await request(`/rest/v1/lab_tests?${query}`, { token: session.access_token });
    } catch (error) {
      if (/lab_tests|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async getPharmacies() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    try {
      return await request("/rest/v1/rpc/list_pharmacies", { method: "POST", token: session.access_token, body: {} });
    } catch (error) {
      if (/list_pharmacies|schema cache/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async getMyPrescriptions() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,note,status,expires_at,created_at,attachment_path,quotes:prescription_quotes(id,price_egp,note,delivery_available,eta_minutes,pharmacy:providers(display_name))",
      status: "neq.closed", order: "created_at.desc", limit: "20"
    });
    try {
      return await request(`/rest/v1/prescription_requests?${query}`, { token: session.access_token });
    } catch (error) {
      if (/prescription_requests|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async submitPrescription(values) {
    assertLiveWritesAllowed("إرسال روشتة");
    const note = String(values?.note || "").trim();
    const pharmacies = [...new Set(values?.pharmacies || [])];
    const file = values?.file && values.file.size ? values.file : null;
    if (note.length < 5) throw new Error("اكتب أسماء الأدوية (5 حروف على الأقل).");
    if (pharmacies.length < 1 || pharmacies.length > 5) throw new Error("اختر من صيدلية إلى 5 صيدليات.");
    if (values?.consent !== true) throw new Error("وافق على مشاركة الروشتة مع الصيدليات المختارة.");
    const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
    if (file && (!types[file.type] || file.size > 5 * 1024 * 1024)) throw new Error("الملف صورة JPG أو PNG أو WebP أو PDF بحد أقصى 5 ميجا.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const token = session.access_token;
    const id = await request("/rest/v1/rpc/submit_prescription_request", { method: "POST", token, body: { p_note: note } });
    let uploadedPath = null;
    try {
      if (file) {
        const path = `${id}/rx-${Date.now()}.${types[file.type]}`;
        uploadedPath = path; // set before the request: a timeout may still have stored the file
        const upload = await fetch(`${API_ROOT}/storage/v1/object/prescriptions/${path}`, { method: "POST", headers: { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${token}`, "Content-Type": file.type }, body: file });
        if (!upload.ok) throw new Error("تعذر رفع الملف.");
        await request("/rest/v1/rpc/attach_prescription_file", { method: "POST", token, body: { p_request: id, p_path: path } });
      }
      await request("/rest/v1/rpc/rx_set_audience", { method: "POST", token, body: { p_request: id, p_pharmacies: pharmacies, p_consent: true } });
    } catch (error) {
      // Compensate: delete the uploaded file through the Storage API and verify it is gone, then close the request.
      const cleaned = uploadedPath ? await removeUploadedPrescriptionFile(token, uploadedPath) : true;
      try { await request("/rest/v1/rpc/customer_close_prescription_request", { method: "POST", token, body: { p_request: id } }); } catch { /* best effort */ }
      if (!cleaned) {
        writePendingCleanups([...readPendingCleanups(), { path: uploadedPath, at: Date.now() }]); // actionable record, retried by retryPendingFileCleanups
        throw new Error("تعذر إرسال الطلب، وفشل حذف الملف المرفوع وقد يظل موجودًا. أُغلق الطلب، وسُجل الملف على هذا الجهاز لإعادة محاولة حذفه عند فتح التطبيق.");
      }
      throw error;
    }
    return id;
  },

  async retryPendingFileCleanups() {
    const pending = readPendingCleanups();
    if (!pending.length) return 0;
    const session = await getValidSession();
    if (!session?.access_token) return pending.length;
    const remaining = [];
    for (const item of pending) {
      if (!(await removeUploadedPrescriptionFile(session.access_token, item.path))) remaining.push(item);
    }
    writePendingCleanups(remaining);
    return remaining.length;
  },

  async getProviderHealthWorkspace(provider) {
    const session = await getValidSession();
    if (!session?.access_token || provider?.kind !== "merchant") return null;
    const token = session.access_token;
    try {
      if (provider.specialty === "pharmacy") {
        const query = new URLSearchParams({
          select: "id,note,status,expires_at,created_at,attachment_path,quotes:prescription_quotes(id,price_egp,note,delivery_available,eta_minutes)",
          status: "neq.closed", order: "created_at.desc", limit: "30"
        });
        return { kind: "pharmacy", requests: await request(`/rest/v1/prescription_requests?${query}`, { token }) };
      }
      if (["lab", "radiology"].includes(provider.specialty)) {
        const query = new URLSearchParams({ select: "id,kind,name,price_egp,active", provider_id: `eq.${provider.id}`, order: "name.asc", limit: "100" });
        return { kind: provider.specialty, tests: await request(`/rest/v1/lab_tests?${query}`, { token }) };
      }
    } catch (error) {
      if (/prescription_requests|lab_tests|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
    return null;
  },

  async getMyProducts(providerId) {
    const session = await getValidSession();
    if (!session?.access_token || !providerId) return null;
    const query = new URLSearchParams({ select: "id,name,price_egp,stock,active,category", merchant_id: `eq.${providerId}`, order: "id.desc", limit: "100" });
    return request(`/rest/v1/products?${query}`, { token: session.access_token });
  },

  async saveProduct(values) {
    assertLiveWritesAllowed("إضافة منتج");
    const name = String(values?.name || "").trim(), price = Number(values?.price), stock = Number(values?.stock);
    if (name.length < 2 || name.length > 120) throw new Error("اكتب اسم المنتج (من 2 إلى 120 حرفًا).");
    if (!["market", "food", "supplies"].includes(values.category)) throw new Error("اختر تصنيف المنتج.");
    if (!Number.isInteger(price) || price < 1 || price > 100000) throw new Error("السعر من 1 إلى 100000 جنيه.");
    if (!Number.isInteger(stock) || stock < 0 || stock > 10000) throw new Error("المخزون من 0 إلى 10000.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const rows = await request("/rest/v1/rpc/merchant_add_product", { method: "POST", token: session.access_token, body: { p_name: name, p_category: values.category, p_price: price, p_stock: stock } });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("لم يتم حفظ المنتج.");
    return rows[0];
  },

  async importProducts(rows, commit) {
    if (commit) assertLiveWritesAllowed("استيراد منتجات");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/merchant_import_products", { method: "POST", token: session.access_token, body: { p_rows: rows, p_commit: commit === true } });
  },

  async staffImportProducts(merchantId, rows, commit) {
    if (commit) assertLiveWritesAllowed("استيراد منتجات");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/staff_import_products", { method: "POST", token: session.access_token, body: { p_merchant: merchantId, p_rows: rows, p_commit: commit === true } });
  },

  async updateProduct(productId, changes) {
    assertLiveWritesAllowed("تعديل منتج");
    if (!Number.isInteger(Number(productId))) throw new Error("اختر المنتج.");
    const body = {};
    if (changes && "active" in changes) body.active = changes.active === true;
    if (changes && "name" in changes) {
      const name = String(changes.name || "").trim();
      if (name.length < 2 || name.length > 120) throw new Error("اكتب اسم المنتج (من 2 إلى 120 حرفًا).");
      body.name = name;
    }
    if (changes && "price" in changes) {
      const price = Number(changes.price);
      if (!Number.isInteger(price) || price < 1 || price > 100000) throw new Error("السعر من 1 إلى 100000 جنيه.");
      body.price_egp = price;
    }
    if (changes && "category" in changes) {
      if (!["market", "food", "supplies"].includes(changes.category)) throw new Error("اختر تصنيف المنتج.");
      body.category = changes.category;
    }
    if (changes && "stock" in changes) {
      const stock = Number(changes.stock);
      if (!Number.isInteger(stock) || stock < 0 || stock > 10000) throw new Error("المخزون من 0 إلى 10000.");
      body.stock = stock;
    }
    if (!Object.keys(body).length) throw new Error("لا يوجد تغيير.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const rows = await request(`/rest/v1/products?${new URLSearchParams({ id: `eq.${Number(productId)}` })}`, { method: "PATCH", token: session.access_token, headers: { Prefer: "return=representation" }, body });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("لم يتم تعديل المنتج. قد لا يكون ملكك.");
    return rows[0];
  },

  async pharmacyQuote(values) {
    assertLiveWritesAllowed("الرد على روشتة");
    const price = Number(values?.price), eta = values?.eta === "" || values?.eta == null ? null : Number(values.eta);
    if (!values?.requestId) throw new Error("اختر الطلب.");
    if (!Number.isInteger(price) || price < 1 || price > 20000) throw new Error("السعر من 1 إلى 20000.");
    if (eta !== null && (!Number.isInteger(eta) || eta < 5 || eta > 2880)) throw new Error("مدة التوصيل من 5 إلى 2880 دقيقة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/pharmacy_quote_request", {
      method: "POST", token: session.access_token,
      body: { p_request: values.requestId, p_price: price, p_note: String(values.note || "").trim() || null, p_delivery: values.delivery === true, p_eta: eta }
    });
  },

  async upsertLabTest(values) {
    assertLiveWritesAllowed("تحديث سعر تحليل");
    const name = String(values?.name || "").trim(), price = Number(values?.price);
    if (!["lab", "radiology"].includes(values?.kind)) throw new Error("نوع الحساب غير مناسب.");
    if (name.length < 3 || name.length > 120) throw new Error("اكتب اسم التحليل أو الأشعة.");
    if (!Number.isInteger(price) || price < 1 || price > 20000) throw new Error("السعر من 1 إلى 20000.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/provider_upsert_lab_test", { method: "POST", token: session.access_token, body: { p_name: name, p_kind: values.kind, p_price: price } });
  },

  async setLabTestActive(testId, active) {
    assertLiveWritesAllowed("تعديل تحليل");
    if (!testId) throw new Error("اختر التحليل.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/provider_set_lab_test_active", { method: "POST", token: session.access_token, body: { p_test: testId, p_active: active === true } });
  },

  // Returns a short-lived blob URL for the prescription file. Reads go straight to private storage (see draft 0801 for the audited proxy path).
  async getPrescriptionFileUrl(path) {
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/.test(String(path || ""))) throw new Error("مسار الملف غير صالح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const response = await fetch(`${API_ROOT}/storage/v1/object/authenticated/prescriptions/${path}`, { headers: { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("تعذر فتح المرفق. قد يكون الطلب أُغلق أو سُحبت المشاركة.");
    return URL.createObjectURL(await response.blob());
  },

  async getMedicalNotes() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const token = session.access_token;
    try {
      const notes = await request(`/rest/v1/medical_notes?${new URLSearchParams({ select: "id,note,created_at,order_id", order: "created_at.desc", limit: "30" })}`, { token });
      const targets = await request(`/rest/v1/orders?${new URLSearchParams({ select: "id,ref,created_at,customer_id", sector: "in.(clinic,nursing)", order: "created_at.desc", limit: "20" })}`, { token }).catch(() => []);
      return { notes, targets };
    } catch (error) {
      if (/medical_notes|schema cache|relation/i.test(String(error?.message))) return null;
      throw error;
    }
  },

  async doctorOpenPatientFile(patientId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(patientId || ""))) throw new Error("اختر المريض.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    try {
      return await request("/rest/v1/rpc/doctor_open_patient_file", { method: "POST", token: session.access_token, body: { p_patient: patientId } });
    } catch (error) {
      throw new Error(patientFileDeniedMessage(error?.message));
    }
  },

  async doctorAddNote(values) {
    assertLiveWritesAllowed("إضافة ملاحظة طبية");
    const note = String(values?.note || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(values?.orderId || ""))) throw new Error("اختر الحالة.");
    if (note.length < 3 || note.length > 2000) throw new Error("الملاحظة من 3 إلى 2000 حرف.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/doctor_add_note", { method: "POST", token: session.access_token, body: { p_order: values.orderId, p_note: note } });
  },

  async closePrescription(requestId) {
    assertLiveWritesAllowed("إغلاق الطلب");
    if (!requestId) throw new Error("اختر الطلب.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/customer_close_prescription_request", { method: "POST", token: session.access_token, body: { p_request: requestId } });
  },

  async teacherCreateSession(values) {
    assertLiveWritesAllowed("إنشاء حصة");
    const title = String(values?.title || "").trim(), subject = String(values?.subject || "").trim();
    const seats = Number(values?.seats), price = Number(values?.price), minutes = Number(values?.minutes || 60);
    if (title.length < 3 || subject.length < 2) throw new Error("اكتب عنوان الحصة والمادة.");
    if (!values?.starts || Number.isNaN(new Date(values.starts).getTime())) throw new Error("اختر موعد الحصة.");
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) throw new Error("عدد المقاعد من 1 إلى 30.");
    if (!Number.isInteger(price) || price < 0 || price > 5000) throw new Error("السعر من 0 إلى 5000.");
    if (!["online", "in_person"].includes(values?.mode)) throw new Error("اختر نوع الحصة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    if (values?.course) {
      // A session of a course is free to join for enrolled students; the course carries any price.
      return request("/rest/v1/rpc/teacher_create_course_session", {
        method: "POST", token: session.access_token,
        body: { p_course: String(values.course), p_title: title, p_subject: subject, p_starts: new Date(values.starts).toISOString(), p_minutes: minutes, p_mode: values.mode, p_seats: seats }
      });
    }
    return request("/rest/v1/rpc/teacher_create_session", {
      method: "POST", token: session.access_token,
      body: { p_title: title, p_subject: subject, p_starts: new Date(values.starts).toISOString(), p_minutes: minutes, p_mode: values.mode, p_seats: seats, p_price: price }
    });
  },

  async getSessionLinks() {
    const session = await getValidSession();
    if (!session?.access_token) return {};
    try {
      const rows = await request("/rest/v1/session_join_links?select=session_id,url", { token: session.access_token });
      return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [row.session_id, row.url]));
    } catch (error) {
      if (/session_join_links/.test(String(error?.message))) return {};
      throw error;
    }
  },

  async teacherSetSessionLink(sessionId, url) {
    assertLiveWritesAllowed("حفظ رابط الحصة");
    if (!sessionId) throw new Error("اختر الحصة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/teacher_set_session_link", { method: "POST", token: session.access_token, body: { p_session: sessionId, p_url: url } });
  },

  async teacherCancelSession(sessionId) {
    assertLiveWritesAllowed("إلغاء حصة");
    if (!sessionId) throw new Error("اختر الحصة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/teacher_cancel_session", { method: "POST", token: session.access_token, body: { p_session: sessionId } });
  },

  async getDoctors() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,display_name,specialty,area,clinic_fee_egp",
      kind: "eq.doctor", approved: "eq.true", active: "eq.true", is_test: "eq.false",
      order: "display_name.asc", limit: "20"
    });
    try {
      return await request(`/rest/v1/providers?${query}`, { token: session.access_token });
    } catch (error) {
      // Per-doctor fee column exists only after the fee draft.
      if (!/clinic_fee_egp/.test(String(error?.message))) throw error;
      query.set("select", "id,display_name,specialty,area");
      return request(`/rest/v1/providers?${query}`, { token: session.access_token });
    }
  },

  async getClinicFees() {
    const session = await getValidSession();
    if (!session?.access_token) return {};
    const rows = await request(`/rest/v1/providers?${new URLSearchParams({ select: "id,clinic_fee_egp", kind: "eq.doctor", limit: "100" })}`, { token: session.access_token });
    return Object.fromEntries((Array.isArray(rows) ? rows : []).map((r) => [r.id, r.clinic_fee_egp]));
  },

  async adminSetClinicFee(providerId, fee) {
    assertLiveWritesAllowed("سعر الكشف");
    const n = Number(fee);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error("اكتب سعر كشف صحيح بالجنيه.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/admin_set_clinic_fee", { method: "POST", token: session.access_token, body: { p_provider: providerId, p_fee: n } });
  },

  async getMySchedule(providerId) {
    const session = await getValidSession();
    if (!session?.access_token || !providerId) return [];
    const rows = await request(`/rest/v1/provider_schedules?${new URLSearchParams({ select: "weekday,start_time,end_time,slot_minutes,active", provider_id: `eq.${providerId}`, order: "weekday.asc", limit: "20" })}`, { token: session.access_token });
    return Array.isArray(rows) ? rows : [];
  },

  async doctorSetSchedule(weekday, start, end, slot) {
    assertLiveWritesAllowed("جدول المواعيد");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/doctor_set_schedule", { method: "POST", token: session.access_token, body: { p_weekday: Number(weekday), p_start: start, p_end: end, p_slot: Number(slot) } });
  },

  async doctorClearScheduleDay(weekday) {
    assertLiveWritesAllowed("جدول المواعيد");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/doctor_clear_schedule_day", { method: "POST", token: session.access_token, body: { p_weekday: Number(weekday) } });
  },

  async getDeliveryPromo() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const rows = await request("/rest/v1/rpc/delivery_promo_public", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  },

  async getDeliveryAreas() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    const rows = await request("/rest/v1/rpc/delivery_areas_public", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) ? rows.map((r) => ({ name: r.out_name, zone: r.out_zone || "inside" })) : [];
  },

  async getDeliveryPromoStatus() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const rows = await request("/rest/v1/rpc/admin_delivery_promo_status", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  },

  async adminSetDeliveryPromo(v) {
    assertLiveWritesAllowed("عرض التوصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const int = (x) => (x === "" || x == null ? null : Number(x));
    return request("/rest/v1/rpc/admin_set_delivery_promo", { method: "POST", token: session.access_token, body: {
      p_enabled: v.enabled === true, p_list_fee: int(v.listFee), p_starts: v.starts || null, p_ends: v.ends || null,
      p_max_free: int(v.maxFree), p_per_customer: int(v.perCustomer), p_pay_inside: int(v.payInside), p_pay_outside: int(v.payOutside), p_budget: int(v.budget) } });
  },

  async adminSetDeliveryAreas(inside, outside) {
    assertLiveWritesAllowed("مناطق التوصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/admin_set_delivery_areas", { method: "POST", token: session.access_token, body: { p_inside: inside, p_outside: outside } });
  },

  async staffDispatchOrder(orderId, area) {
    assertLiveWritesAllowed("تحويل الطلب لمندوب");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/staff_dispatch_order", { method: "POST", token: session.access_token, body: area ? { p_order: orderId, p_area: area } : { p_order: orderId } });
  },

  async getClinicSlots(providerId, day) {
    if (!providerId || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return [];
    const session = await getValidSession();
    if (!session?.access_token) return [];
    const rows = await request("/rest/v1/rpc/clinic_available_slots", {
      method: "POST", token: session.access_token, body: { p_provider: providerId, p_day: day }
    });
    return Array.isArray(rows) ? rows.map((r) => r.slot) : [];
  },

  async bookClinicSlot(providerId, slot, notes) {
    assertLiveWritesAllowed("حجز موعد العيادة");
    if (!providerId || !slot) throw new Error("اختر الطبيب والموعد.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    try {
      return await request("/rest/v1/rpc/book_clinic_slot", {
        method: "POST", token: session.access_token,
        body: { p_provider: providerId, p_at: slot, p_notes: String(notes || "").trim().slice(0, 300) || null, p_source: "web" }
      });
    } catch (error) {
      if (/permission denied/i.test(String(error?.message))) throw new Error("حجز العيادات غير مفعل حاليًا.");
      throw error;
    }
  },

  async doctorSetAppointmentStatus(orderId, status, note = null) {
    assertLiveWritesAllowed("تحديث حالة الموعد");
    if (!orderId || !["confirmed", "in_progress", "done", "cancelled"].includes(status)) throw new Error("تحديث الحالة غير صالح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/doctor_set_appointment_status", {
      method: "POST", token: session.access_token, body: { p_order: orderId, p_to: status, p_note: note }
    });
  },

  async getProducts() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const build = (select, category) => { const p = new URLSearchParams({ select, active: "eq.true", stock: "gt.0", order: "id.asc", limit: "50" }); if (category) p.set("category", `eq.${category}`); return p; };
    try {
      // One small page per category, so a big market catalogue cannot crowd out restaurants or supplies.
      const pages = await Promise.all(["market", "food", "supplies"].map((c) => request(`/rest/v1/products?${build(PRODUCT_SELECT, c)}`, { token: session.access_token })));
      return pages.flat();
    } catch (error) {
      // Before the category/aisle drafts are applied the extra columns do not exist.
      if (!/category|aisle|unit|image_url|barcode/.test(String(error?.message))) throw error;
      const rows = await request(`/rest/v1/products?${build("id,name,price_egp,discount_price_egp,stock")}`, { token: session.access_token });
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, category: "market" })) : rows;
    }
  },

  // Server-side search and paging for big catalogues. Asks for one extra row to know whether more exist.
  async searchProducts({ category, q, aisle, offset = 0, limit = 24 }) {
    const session = await getValidSession();
    if (!session?.access_token) return { rows: [], more: false };
    if (!["market", "food", "supplies"].includes(category)) return { rows: [], more: false };
    const p = new URLSearchParams({ select: PRODUCT_SELECT, active: "eq.true", stock: "gt.0", category: `eq.${category}`, order: "id.asc", limit: String(limit + 1), offset: String(Math.max(0, Number(offset) || 0)) });
    const term = String(q || "").replace(/[%*,()\\]/g, " ").trim().slice(0, 60);
    if (term) p.set("name", `ilike.*${term}*`);
    if (aisle && /^[a-z]{3,12}$/.test(aisle)) p.set("aisle", `eq.${aisle}`);
    const rows = await request(`/rest/v1/products?${p}`, { token: session.access_token });
    const list = Array.isArray(rows) ? rows : [];
    return { rows: list.slice(0, limit), more: list.length > limit };
  },

  async getProductsByIds(ids) {
    const session = await getValidSession();
    const list = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 30);
    if (!session?.access_token || !list.length) return [];
    const p = new URLSearchParams({ select: PRODUCT_SELECT, active: "eq.true", stock: "gt.0", id: `in.(${list.join(",")})` });
    const rows = await request(`/rest/v1/products?${p}`, { token: session.access_token });
    return Array.isArray(rows) ? rows : [];
  },

  async getMerchantNames(ids) {
    const list = [...new Set((ids || []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!list.length) return {};
    const session = await getValidSession();
    if (!session?.access_token) return {};
    try {
      const rows = await request(`/rest/v1/providers?${new URLSearchParams({ select: "id,display_name", id: `in.(${list.join(",")})` })}`, { token: session.access_token });
      return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row.display_name]));
    } catch { return {}; }
  },

  async placeCartOrder(lines, address, notes) {
    assertLiveWritesAllowed("طلب منتجات");
    const clean = (Array.isArray(lines) ? lines : []).map((line) => ({ product: Number(line.product), qty: Number(line.qty) }));
    if (!clean.length || clean.length > 10) throw new Error("السلة من 1 إلى 10 أصناف.");
    if (clean.some((line) => !Number.isInteger(line.product) || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20)) throw new Error("الكمية من 1 إلى 20.");
    const a = String(address || "").trim();
    if (a.length < 5) throw new Error("اكتب عنوان التسليم بوضوح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/place_cart_order", {
      method: "POST", token: session.access_token,
      body: { p_lines: clean, p_address: a, p_notes: String(notes || "").trim().slice(0, 300) || null, p_source: "web" }
    });
  },

  async merchantRespondStoreOrder(orderId, accept, note = null) {
    assertLiveWritesAllowed("الرد على طلب متجر");
    if (!orderId || typeof accept !== "boolean") throw new Error("بيانات الرد غير صالحة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/merchant_respond_store_order", {
      method: "POST", token: session.access_token,
      body: { p_order: orderId, p_accept: accept, p_note: note ? String(note).slice(0, 300) : null }
    });
  },

  async placeProductOrder(productId, qty, address, notes) {
    assertLiveWritesAllowed("طلب منتج");
    const q = Number(qty);
    if (!productId) throw new Error("اختر المنتج.");
    if (!Number.isInteger(q) || q < 1 || q > 20) throw new Error("الكمية من 1 إلى 20.");
    const a = String(address || "").trim();
    if (a.length < 4) throw new Error("اكتب عنوان التسليم بوضوح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    try {
      return await request("/rest/v1/rpc/place_product_order", {
        method: "POST", token: session.access_token,
        body: { p_product: Number(productId), p_qty: q, p_address: a, p_notes: String(notes || "").trim().slice(0, 300) || null, p_source: "web" }
      });
    } catch (error) {
      if (/permission denied/i.test(String(error?.message))) throw new Error("طلب المنتجات غير مفعل حاليًا.");
      throw error;
    }
  },

  async getNursingItems() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({ select: "id,name,price_egp", sector: "eq.nursing", active: "eq.true", nursing_intake_open: "eq.true", order: "id.asc" });
    return request(`/rest/v1/service_items?${query}`, { token: session.access_token });
  },

  // Health-data consent is separate from terms and privacy. It is asked at the nursing form, never silently.
  async requestNursingVisit({ itemId, address, notes, consent, terms, preferredAt }) {
    assertLiveWritesAllowed("طلب زيارة تمريض");
    if (!Number.isInteger(Number(itemId))) throw new Error("اختر الخدمة.");
    const a = String(address || "").trim();
    if (a.length < 8) throw new Error("اكتب عنوان الزيارة بوضوح.");
    if (terms !== true) throw new Error("لازم توافق على الشروط والخصوصية.");
    if (consent !== true) throw new Error("لازم توافق على استخدام بياناتك الصحية لطلب التمريض.");
    // Validate the proposed time before anything is created, so a bad time never leaves an order behind.
    if (preferredAt) { const problem = cairoLocalProblem(preferredAt); if (problem) throw new Error(problem); }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    await this.acceptRequiredConsents();
    await request("/rest/v1/rpc/accept_consent", { method: "POST", token: session.access_token, body: { p_kind: "health_data", p_version: HEALTH_CONSENT_VERSION } });
    const rows = await request("/rest/v1/rpc/request_nursing_visit", {
      method: "POST", token: session.access_token,
      body: { p_item: Number(itemId), p_address: a, p_notes: String(notes || "").trim().slice(0, 300) || null, p_idempotency_key: crypto.randomUUID() }
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("لم يتم إرسال الطلب.");
    // The preferred time is only a proposal. A failure here must not lose the order that was already created.
    if (preferredAt) {
      try { await this.setNursingPreferredTime({ orderId: rows[0].out_order_id, value: preferredAt }); }
      catch { return { ...rows[0], preferredTimeSaved: false }; }
      return { ...rows[0], preferredTimeSaved: true };
    }
    return rows[0];
  },

  // Time-only step, also used to retry without creating another order.
  async setNursingPreferredTime({ orderId, value }) {
    assertLiveWritesAllowed("تحديد موعد مقترح");
    const problem = cairoLocalProblem(value);
    if (problem) throw new Error(problem);
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    await request("/rest/v1/rpc/set_nursing_preferred_time", { method: "POST", token: session.access_token, body: { p_order: orderId, p_at: cairoLocalToDate(value).toISOString() } });
  },

  async placeDeliveryRequest(pickup, dropoff, what, area, pin) {
    assertLiveWritesAllowed("طلب التوصيل");
    const p = String(pickup || "").trim(), q = String(dropoff || "").trim(), w = String(what || "").trim();
    if (p.length < 4 || q.length < 4) throw new Error("اكتب عنوان الاستلام وعنوان التسليم بوضوح.");
    if (w.length < 2) throw new Error("اكتب ما سيتم توصيله.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/place_delivery_request", {
      method: "POST",
      token: session.access_token,
      body: { p_pickup: p, p_dropoff: q, p_what: w, ...(area ? { p_area: String(area) } : {}), ...(pin && Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lng)) ? { p_lat: Number(pin.lat), p_lng: Number(pin.lng) } : {}) }
    });
  },

  async saveDeliveryLocations(requestId, pickup, dropoff, consent) {
    assertLiveWritesAllowed("حفظ مواقع التوصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/save_delivery_locations", {
      method: "POST",
      token: session.access_token,
      body: { p_request: requestId, p_pickup_lat: Number(pickup.lat), p_pickup_lng: Number(pickup.lng), p_dropoff_lat: Number(dropoff.lat), p_dropoff_lng: Number(dropoff.lng), p_consent: Boolean(consent) }
    });
  },

  async getDeliveryLocations(requestId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const rows = await request("/rest/v1/rpc/courier_get_delivery_locations", { method: "POST", token: session.access_token, body: { p_request: requestId } });
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  },

  async cancelDelivery(requestId) {
    assertLiveWritesAllowed("إلغاء طلب التوصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/customer_cancel_delivery", {
      method: "POST",
      token: session.access_token,
      body: { p_request: requestId }
    });
  },

  async getDeliveryQueue() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const query = new URLSearchParams({
      select: "id,ref,pickup_address,dropoff_address,what_to_deliver,status,courier_id,created_at" + DELIVERY_FEE_COLUMNS,
      order: "created_at.desc",
      limit: "50"
    });
    try {
      try {
        return await request(`/rest/v1/delivery_requests?${query}`, { token: session.access_token });
      } catch (inner) {
        // Fee columns exist only after the promo draft; fall back to the base columns.
        if (!/customer_fee_egp|promo_applied|courier_pay_egp|order_id|area|zone/.test(String(inner?.message))) throw inner;
        query.set("select", "id,ref,pickup_address,dropoff_address,what_to_deliver,status,courier_id,created_at");
        return await request(`/rest/v1/delivery_requests?${query}`, { token: session.access_token });
      }
    } catch (error) {
      if (/delivery_requests/.test(String(error?.message))) return null;
      throw error;
    }
  },

  async assignDelivery(requestId, courierId) {
    assertLiveWritesAllowed("تعيين مندوب التوصيل");
    if (!requestId || !courierId) throw new Error("اختر الطلب والمندوب.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/assign_delivery", {
      method: "POST",
      token: session.access_token,
      body: { p_request: requestId, p_courier: courierId }
    });
  },

  async getCashSummary() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const rows = await request("/rest/v1/rpc/courier_cash_summary", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) && rows[0] ? { pending: rows[0].out_pending, holding: rows[0].out_holding_egp, remitted: rows[0].out_remitted_egp, notCollected: rows[0].out_not_collected } : null;
  },

  async getCourierCollections() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    const rows = await request("/rest/v1/rpc/courier_my_collections", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) ? rows.map((r) => ({ delivery: r.out_delivery, ref: r.out_ref, due: r.out_due, status: r.out_status, collected: r.out_collected, remitted: r.out_remitted })) : [];
  },

  async courierRecordCollection(deliveryId, collected, amount, note) {
    assertLiveWritesAllowed("تسجيل التحصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    const body = { p_delivery: deliveryId, p_collected: Boolean(collected) };
    if (collected && Number.isFinite(Number(amount)) && String(amount).trim() !== "") body.p_amount = Math.round(Number(amount));
    if (String(note || "").trim()) body.p_note = String(note).trim();
    return request("/rest/v1/rpc/courier_record_collection", { method: "POST", token: session.access_token, body });
  },

  async getStaffBurn() {
    const session = await getValidSession();
    if (!session?.access_token) return null;
    const rows = await request("/rest/v1/rpc/staff_delivery_burn", { method: "POST", token: session.access_token, body: {} });
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? { freeCount: r.out_free_count, freeCost: r.out_free_cost_egp, subsidyCount: r.out_subsidy_count, subsidy: r.out_subsidy_egp, total: r.out_total_burn_egp, cap: r.out_cap_egp, remaining: r.out_remaining_egp } : null;
  },

  async getStaffCashLedger() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    const rows = await request("/rest/v1/rpc/staff_cash_ledger", { method: "POST", token: session.access_token, body: {} });
    return Array.isArray(rows) ? rows.map((r) => ({ courier: r.out_courier, name: r.out_name, pending: r.out_pending, holding: r.out_holding_egp, remitted: r.out_remitted_egp, notCollected: r.out_not_collected, waived: r.out_waived, courierPay: r.out_courier_pay_egp, share: r.out_platform_share_egp, subsidy: r.out_subsidy_egp })) : [];
  },

  async staffRecordRemittance(courierId, amount) {
    assertLiveWritesAllowed("تسجيل التوريد");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/staff_record_remittance", { method: "POST", token: session.access_token, body: { p_courier: courierId, p_amount: Math.round(Number(amount)) } });
  },

  async courierSetDeliveryStatus(requestId, status) {
    assertLiveWritesAllowed("تحديث حالة التوصيل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/courier_set_delivery_status", {
      method: "POST",
      token: session.access_token,
      body: { p_request: requestId, p_to: status }
    });
  },

  async customerCancelOrder(orderId, reason = "") {
    assertLiveWritesAllowed("إلغاء الطلب");
    if (!orderId) throw new Error("الطلب غير محدد.");
    const note = String(reason || "").trim();
    if (note.length > 500) throw new Error("سبب الإلغاء يجب ألا يتجاوز 500 حرف.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/customer_cancel_order_v2", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_reason: note || null }
    });
  },

  async updateOrderStatus(orderId, status, note = null) {
    assertLiveWritesAllowed("تغيير حالات الطلبات");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/staff_set_order_status_v2", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_to: status, p_note: note }
    });
  },

  async quoteOrder(orderId, price) {
    assertLiveWritesAllowed("إرسال عروض الأسعار");
    const numericPrice = Number(price);
    if (!Number.isInteger(numericPrice) || numericPrice < 0 || numericPrice > 10000000) {
      throw new Error("أدخل سعرًا صحيحًا بالجنيه.");
    }
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    // Quotes must wait for the customer's acceptance. If the versioned RPC is missing
    // (database not migrated), refuse instead of falling back to the legacy confirm-immediately RPC.
    try {
      const version = await request("/rest/v1/rpc/quote_order_v3", {
        method: "POST",
        token: session.access_token,
        body: { p_order: orderId, p_price: numericPrice }
      });
      return { version };
    } catch (error) {
      if (/quote_order_v3/.test(String(error?.message)) && /find the function|schema cache/i.test(String(error?.message))) {
        throw new Error("إرسال عروض الأسعار يحتاج تحديث قاعدة البيانات أولًا (ترحيل موافقة العميل على السعر). لم يتم إرسال أي عرض.");
      }
      throw error;
    }
  },

  async assignOrder(orderId, providerId) {
    assertLiveWritesAllowed("تعيين مقدمي الخدمة");
    if (!orderId || !providerId) throw new Error("اختر الطلب ومقدم الخدمة.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/assign_order_v2", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_provider: providerId }
    });
  },

  async createProviderInvite(kind) {
    assertLiveWritesAllowed("إنشاء دعوات مقدمي الخدمة");
    const allowed = ["doctor", "merchant", "teacher", "courier", "technician"];
    if (!allowed.includes(kind)) throw new Error("نوع مقدم الخدمة غير صالح.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/create_invite", {
      method: "POST",
      token: session.access_token,
      body: { p_kind: kind }
    });
  },

  async redeemProviderInvite(values) {
    assertLiveWritesAllowed("تفعيل دعوة مقدم الخدمة");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/redeem_invite", {
      method: "POST",
      token: session.access_token,
      body: {
        p_code: String(values.code || "").trim().toUpperCase(),
        p_display_name: String(values.display_name || "").trim(),
        p_specialty: String(values.specialty || "").trim(),
        p_area: String(values.area || "").trim()
      }
    });
  },

  async approveProvider(providerId) {
    assertLiveWritesAllowed("اعتماد مقدمي الخدمة");
    if (!providerId) throw new Error("مقدم الخدمة غير محدد.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    return request("/rest/v1/rpc/approve_provider", {
      method: "POST",
      token: session.access_token,
      body: { p_provider: providerId }
    });
  },

  async approveProviderWithService(providerId, { sector, specialty, displayName, price }) {
    assertLiveWritesAllowed("اعتماد مقدمي الخدمة");
    if (!providerId) throw new Error("مقدم الخدمة غير محدد.");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");
    return request("/rest/v1/rpc/admin_approve_provider_with_service", {
      method: "POST",
      token: session.access_token,
      body: { p_provider: providerId, p_sector: sector, p_specialty: String(specialty).trim(), p_display_name: String(displayName).trim(), p_price: Math.round(Number(price)) }
    });
  },

  async acceptRequiredConsents() {
    assertLiveWritesAllowed("حفظ الموافقات");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    await request("/rest/v1/rpc/accept_consent", {
      method: "POST",
      token: session.access_token,
      body: { p_kind: "terms", p_version: POLICY_VERSION }
    });

    await request("/rest/v1/rpc/accept_consent", {
      method: "POST",
      token: session.access_token,
      body: { p_kind: "privacy", p_version: POLICY_VERSION }
    });

    localStorage.removeItem(PENDING_CONSENT_KEY);
  },

  markConsentPending() {
    localStorage.setItem(PENDING_CONSENT_KEY, "1");
  },

  async completePendingConsent(user = null) {
    const pending = localStorage.getItem(PENDING_CONSENT_KEY) === "1";
    const metadata = user?.user_metadata ?? {};
    const acceptedOnSignup = metadata.terms_version === POLICY_VERSION
      && metadata.privacy_version === POLICY_VERSION
      && Boolean(metadata.consent_accepted_at);
    if (!pending && !acceptedOnSignup) return;
    if (CONFIG.isPublicPreview) return;

    const session = await getValidSession();
    if (!session?.access_token) return;

    if (user?.id) {
      const query = new URLSearchParams({
        select: "kind,version",
        user_id: `eq.${user.id}`,
        kind: "in.(terms,privacy)"
      });
      const rows = await request(`/rest/v1/consents?${query}`, {
        token: session.access_token
      });
      const accepted = new Set(
        (Array.isArray(rows) ? rows : [])
          .filter((row) => row.version === POLICY_VERSION)
          .map((row) => row.kind)
      );
      if (accepted.has("terms") && accepted.has("privacy")) {
        localStorage.removeItem(PENDING_CONSENT_KEY);
        return;
      }
    }

    await this.acceptRequiredConsents();
  },

  // Exact coordinates live in order_locations (not on orders). Saved after the order exists, with explicit consent.
  async saveOrderLocation(orderId, { lat, lng, accuracy = null, landmark = null, contactPhone = null, consent = false }) {
    assertLiveWritesAllowed("حفظ موقع الطلب");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    return request("/rest/v1/rpc/save_order_location", {
      method: "POST",
      token: session.access_token,
      body: {
        p_order: orderId,
        p_lat: Number(lat),
        p_lng: Number(lng),
        p_accuracy: Number.isFinite(Number(accuracy)) && accuracy !== null ? Math.round(Number(accuracy)) : null,
        p_landmark: landmark ? String(landmark).trim() : null,
        p_contact_phone: contactPhone ? String(contactPhone).trim() : null,
        p_consent: consent === true
      }
    });
  },

  async saveOrderVehicle(orderId, { make, model, plate, color = null }) {
    assertLiveWritesAllowed("حفظ بيانات السيارة");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    return request("/rest/v1/rpc/save_order_vehicle", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_make: make, p_model: model, p_plate: plate, p_color: color ? String(color).trim() : null }
    });
  },

  // Assigned provider only, active orders only (enforced in the database).
  async getProviderOrderLocation(orderId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    const rows = await request("/rest/v1/rpc/provider_get_order_location", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId }
    });
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  },

  async getMyProviderContact(orderId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    const rows = await request("/rest/v1/rpc/customer_get_provider_contact", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId }
    });
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  },

  async getLocatedOrderIds() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    try {
      const rows = await request("/rest/v1/order_locations?select=order_id&limit=100", { token: session.access_token });
      return Array.isArray(rows) ? rows.map((row) => row.order_id) : [];
    } catch {
      return [];
    }
  },

  async getClinicLocations() {
    const session = await getValidSession();
    if (!session?.access_token) return [];
    const rows = await request("/rest/v1/clinic_locations?select=provider_id,lat,lng,address&limit=200", { token: session.access_token });
    return Array.isArray(rows) ? rows : [];
  },

  async setClinicLocation({ lat, lng, address }) {
    assertLiveWritesAllowed("حفظ موقع العيادة");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    return request("/rest/v1/rpc/provider_set_clinic_location", {
      method: "POST",
      token: session.access_token,
      body: { p_lat: Number(lat), p_lng: Number(lng), p_address: String(address || "").trim() }
    });
  },

  async setProviderPhone(phone) {
    assertLiveWritesAllowed("حفظ رقم التواصل");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
    return request("/rest/v1/rpc/provider_set_phone", {
      method: "POST",
      token: session.access_token,
      body: { p_phone: String(phone).trim() }
    });
  },

  async createServiceOrder(service, { address, notes, location = null, idempotencyKey = null }) {
    assertLiveWritesAllowed("إرسال الطلبات");
    if (!service?.id || !service?.sector) {
      throw new Error("الخدمة المختارة غير صالحة.");
    }

    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");

    const key = idempotencyKey || (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `wsl-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`);

    return request("/rest/v1/rpc/place_order_v2", {
      method: "POST",
      token: session.access_token,
      body: {
        p_sector: service.sector,
        p_item_id: Number(service.id),
        p_address: String(address).trim(),
        p_notes: String(notes ?? "").trim() || null,
        p_source: "web",
        p_idempotency_key: key,
        p_lat: null,
        p_lng: null
      }
    });
  }
};

export function hasPendingConsent() {
  return localStorage.getItem(PENDING_CONSENT_KEY) === "1";
}
