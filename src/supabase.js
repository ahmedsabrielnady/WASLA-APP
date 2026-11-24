import { CONFIG } from "./config.js";
import { validateRoadmapUpdate } from "./domain.js";
import { normalizeEgyptianPhone, resolveAuthIdentifier } from "./auth-utils.js";
import { fetchTextWithTimeout } from "./network.js";

const SESSION_KEY = "wasla.auth.session.v1";
const PENDING_CONSENT_KEY = "wasla.pending-consent.v1";
const OAUTH_VERIFIER_KEY = "wasla.auth.google-pkce-verifier.v1";
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
    const result = await authRequest("/auth/v1/token?grant_type=password", {
      [resolved.type]: resolved.value,
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
    const result = await authRequest("/auth/v1/signup", {
      [resolved.type]: resolved.value,
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
      select: "id,sector,name,price_egp,active,public_orderable",
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
      select: "id,ref,sector,status,price_egp,deposit_egp,deposit_paid,created_at,updated_at,scheduled_at,address,provider_id,item_id,product_id,quantity",
      order: "created_at.desc",
      limit: "50"
    });

    return request(`/rest/v1/orders?${query}`, {
      token: session.access_token
    });
  },

  async getOperationsProviders() {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("سجل الدخول لعرض مقدمي الخدمة.");

    const query = new URLSearchParams({
      select: "id,kind,display_name,specialty,area,approved,active,is_test,created_at",
      order: "created_at.desc",
      limit: "100"
    });

    return request(`/rest/v1/providers?${query}`, {
      token: session.access_token
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
      select: "id,ref,sector,status,price_egp,deposit_egp,created_at,updated_at,scheduled_at,address,notes,quantity",
      provider_id: `eq.${provider.id}`,
      order: "created_at.desc",
      limit: "100"
    });
    const orders = await request(`/rest/v1/orders?${orderQuery}`, {
      token: session.access_token
    });
    return { provider, orders: Array.isArray(orders) ? orders : [] };
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

    return request("/rest/v1/rpc/quote_order", {
      method: "POST",
      token: session.access_token,
      body: { p_order: orderId, p_price: numericPrice }
    });
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
        p_lat: location?.lat == null ? null : Number(location.lat),
        p_lng: location?.lng == null ? null : Number(location.lng)
      }
    });
  }
};

export function hasPendingConsent() {
  return localStorage.getItem(PENDING_CONSENT_KEY) === "1";
}
