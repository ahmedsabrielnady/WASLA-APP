import { CONFIG } from "./config.js";
import { validateRoadmapUpdate } from "./domain.js";

const SESSION_KEY = "wasla.auth.session.v1";
const PENDING_CONSENT_KEY = "wasla.pending-consent.v1";
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
    Authorization: `Bearer ${token || CONFIG.supabasePublishableKey}`,
    Accept: "application/json",
    ...headers
  };

  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache
    });
  } catch {
    throw new Error("تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم أعد المحاولة.");
  }

  const raw = await response.text();
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

  async signIn(email, password) {
    const result = await authRequest("/auth/v1/token?grant_type=password", {
      email: String(email).trim(),
      password
    });
    saveSession(result);
    return result;
  },

  async signUp({ email, password, fullName, phone }) {
    assertLiveWritesAllowed("إنشاء الحسابات");
    const result = await authRequest("/auth/v1/signup", {
      email: String(email).trim(),
      password,
      data: {
        full_name: String(fullName).trim(),
        phone: String(phone).trim()
      }
    });

    if (result?.access_token && result?.refresh_token) {
      saveSession(result);
    }
    return result;
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
      select: "id,sector,name,price_egp,active",
      active: "eq.true",
      order: "sector.asc,name.asc"
    });
    return request(`/rest/v1/service_items?${query}`);
  },

  async getOffers() {
    const query = new URLSearchParams({
      select: "id,text,sort_order",
      active: "eq.true",
      order: "sort_order.asc,id.asc"
    });
    return request(`/rest/v1/offers?${query}`);
  },

  async getMyOrders(userId) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض طلباتك.");

    const query = new URLSearchParams({
      select: "id,ref,sector,status,price_egp,deposit_egp,deposit_paid,created_at,scheduled_at,lat,lng",
      customer_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "30"
    });

    return request(`/rest/v1/orders?${query}`, {
      token: session.access_token
    });
  },

  async getOperationsOrders() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض لوحة التشغيل.");

    const query = new URLSearchParams({
      select: "id,ref,sector,status,price_egp,created_at,scheduled_at",
      order: "created_at.desc",
      limit: "50"
    });

    return request(`/rest/v1/orders?${query}`, {
      token: session.access_token
    });
  },

  async acceptRequiredConsents() {
    assertLiveWritesAllowed("حفظ الموافقات");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول أولًا.");

    await request("/rest/v1/rpc/accept_consent", {
      method: "POST",
      token: session.access_token,
      body: { p_kind: "terms", p_version: "1.0" }
    });

    await request("/rest/v1/rpc/accept_consent", {
      method: "POST",
      token: session.access_token,
      body: { p_kind: "privacy", p_version: "1.0" }
    });

    localStorage.removeItem(PENDING_CONSENT_KEY);
  },

  markConsentPending() {
    localStorage.setItem(PENDING_CONSENT_KEY, "1");
  },

  async completePendingConsent() {
    if (localStorage.getItem(PENDING_CONSENT_KEY) !== "1") return;
    if (CONFIG.isPublicPreview) return;
    await this.acceptRequiredConsents();
  },

  async setOrderLocation(orderId, { lat, lng, address = null }) {
    assertLiveWritesAllowed("حفظ إحداثيات الطلب");
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");

    return request("/rest/v1/rpc/set_order_location", {
      method: "POST",
      token: session.access_token,
      body: {
        p_order: orderId,
        p_lat: Number(lat),
        p_lng: Number(lng),
        p_address: address ? String(address).trim() : null
      }
    });
  },

  async createServiceOrder(service, { address, notes }) {
    assertLiveWritesAllowed("إرسال الطلبات");
    if (!service?.id || !service?.sector) {
      throw new Error("الخدمة المختارة غير صالحة.");
    }

    const session = await getValidSession();
    if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");

    return request("/rest/v1/rpc/place_order", {
      method: "POST",
      token: session.access_token,
      body: {
        p_sector: service.sector,
        p_item_id: Number(service.id),
        p_address: String(address).trim(),
        p_notes: String(notes ?? "").trim() || null,
        p_source: "web"
      }
    });
  }
};

export function hasPendingConsent() {
  return localStorage.getItem(PENDING_CONSENT_KEY) === "1";
}
