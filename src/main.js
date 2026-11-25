import { CONFIG } from "./config.js";
import { isPhoneAliasSignupReady, resolveAuthIdentifier } from "./auth-utils.js";
import { SECTORS, canRequestService, filterOrderableServices, escapeHTML, formatDate, formatEGP, isEgyptianPhone, isValidAddress, isValidCoordinates, runWithBusyState, sectorLabel, statusLabel, validateRoadmapUpdate } from "./domain.js";
import { authApi, dataApi } from "./supabase.js";
import { renderRoadmapHome, renderRoadmapPage } from "./roadmap.js";
import { renderOperationsView } from "./operations.js";
import { renderCrmView } from "./crm.js";
import { renderProviderView } from "./provider.js";

const root = document.querySelector("#app");
const PENDING_ORDER_SERVICE_KEY = "wasla.pending-order-service.v1";

const state = {
  services: [],
  offers: [],
  catalogLoaded: false,
  user: null,
  profile: null,
  session: null,
  view: ["operations", "roadmap", "crm", "provider"].includes(new URLSearchParams(location.search).get("view"))
    ? new URLSearchParams(location.search).get("view")
    : "home",
  modal: null,
  authMode: "login",
  googleAuthEnabled: false,
  phoneAuthReady: false,
  pendingService: null,
  pendingLocation: null,
  pendingAddress: "",
  search: "",
  myOrders: [],
  nursingTimeRetry: null,
  changeRequests: [],
  notifications: [],
  opsChangeRequests: [],
  deliveries: null,
  doctors: null,
  sessions: null,
  enrollments: null,
  teacherSessions: null,
  clinicDoctorId: "",
  clinicDay: "",
  clinicSlots: [],
  products: null,
  deliveryQueue: null,
  trackingOrderId: "",
  trackingLoadingId: "",
  orderTracking: null,
  operationsOrders: [],
  operationsServices: [],
  operationsCoverage: [],
  operationsSaving: false,
  latestInviteCode: "",
  providerInviteSaving: false,
  busy: false,
  loadError: "",
  roadmapItems: [],
  roadmapLoaded: false,
  roadmapAudit: [],
  roadmapError: "",
  roadmapSavingId: "",
  pendingOrderIdempotencyKey: "",
  crmMetrics: null,
  crmCustomers: [],
  crmLeads: [],
  crmTasks: [],
  crmTickets: [],
  crmProviders: [],
  crmSelectedCustomerId: "",
  crmCustomer360: null,
  crmError: "",
  crmSaving: false,
  providerRecord: null,
  providerOrders: [],
  providerError: "",
  providerSaving: false
};

function icon(text) {
  return `<span class="icon" aria-hidden="true">${text}</span>`;
}

function showToast(message, kind = "info") {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3600);
}

function offerTicker() {
  const hasPublishedOffers = state.offers.length > 0;
  const messages = hasPublishedOffers
    ? state.offers.map((offer) => offer.text)
    : ["وصلة تجمع خدماتك المحلية في مكان واحد", "خدمات شبين القناطر أقرب وأسهل مع وصلة"];

  const text = messages.map((message) => escapeHTML(message)).join("　　✦　　");
  const note = hasPublishedOffers
    ? "الإعلانات نصوص منشورة من لوحة المنصة؛ لا يُحتسب خصم تلقائي قبل تفعيل محرك العروض."
    : "لا توجد عروض منشورة حاليًا؛ الرسائل المعروضة تعريفية فقط.";
  return `
    <div class="ticker" aria-label="إعلانات المنصة">
      <div class="ticker-track"><span>${text}</span><span aria-hidden="true">${text}</span></div>
    </div>
    <p class="ticker-note">${note}</p>
  `;
}

function header() {
  const displayName = state.profile?.full_name || state.user?.email || "حسابي";
  const authenticated = Boolean(state.user);
  const isStaff = ["staff", "admin"].includes(state.profile?.role);
  const isProvider = ["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role);

  return `
    <header class="topbar">
      <a class="brand" href="./" data-action="home" aria-label="وصلة - الرئيسية">
        <span class="brand-mark" aria-hidden="true"><span>W</span></span>
        <span class="brand-copy"><strong>WASLA</strong><small>وصلة · كل اللي محتاجه، قريب منك.</small></span>
      </a>
      <nav class="top-actions" aria-label="القائمة الرئيسية">
        <button class="nav-link" data-action="roadmap">خطة الإنجاز</button>
        ${authenticated && state.profile?.role === "customer" ? '<button class="nav-link" data-action="orders">طلباتي</button>' : ""}
        ${isStaff ? '<button class="nav-link" data-action="operations">التشغيل</button><button class="nav-link" data-action="crm">CRM</button>' : ""}
        ${isProvider ? '<button class="nav-link" data-action="provider">طلبات مقدم الخدمة</button>' : ""}
        ${authenticated && state.profile?.role === "customer" ? '<button class="nav-link" data-action="provider-invite">لديك دعوة مقدم خدمة؟</button>' : ""}
        ${authenticated
          ? `<button class="account-chip" data-action="account" title="الحساب">${icon("👤")}<span>${escapeHTML(displayName)}</span></button><button class="btn btn-outline btn-small" data-action="logout">خروج</button>`
          : '<button class="btn btn-primary btn-small" data-action="auth">دخول / حساب جديد</button>'}
      </nav>
    </header>
  `;
}

function sectorCards() {
  return SECTORS.map((sector) => {
    const count = filterOrderableServices(state.services).filter((item) => item.sector === sector.code).length;
    let badge = "قريبًا";
    let detail = sector.description;

    if (sector.mode === "order") {
      badge = count ? `${count} خدمات متاحة للطلب` : "قريبًا";
      if (!count && sector.code === "car") detail = "نفعّل خدمات السيارات بعد اعتماد مقدم خدمة متخصص";
    } else if (sector.mode === "review") {
      badge = "قيد استكمال التشغيل";
      detail = sector.code === "clinic"
        ? "لن نعرض مواعيد قبل اعتماد جداول العيادات"
        : sector.code === "nursing"
          ? "التفعيل بعد مراجعة الخصوصية ومتطلبات التعامل مع البيانات الصحية"
          : "تفعيل التوصيل والتتبع بعد تجهيز دورة الشحنات";
    }

    return `
      <button class="sector-card ${sector.mode === "soon" || (sector.mode === "order" && !count) ? "is-soon" : ""}" ${sector.mode === "order" && !count ? "disabled" : ""} data-action="sector" data-sector="${sector.code}">
        <span class="sector-icon">${sector.icon}</span>
        <strong>${escapeHTML(sector.title)}</strong>
        <span class="sector-description">${escapeHTML(detail)}</span>
        <span class="sector-badge">${escapeHTML(badge)}</span>
      </button>
    `;
  }).join("");
}

function serviceCards() {
  if (!state.catalogLoaded) {
    return '<div class="empty-state" role="status"><strong>جارٍ تحميل الخدمات...</strong><p>نحمّل الخدمات المتاحة من قاعدة بيانات وصلة.</p></div>';
  }

  const search = state.search.trim().toLocaleLowerCase("ar");
  const filtered = filterOrderableServices(state.services).filter((item) => {
    const matchesSearch = !search
      || String(item.name).toLocaleLowerCase("ar").includes(search)
      || sectorLabel(item.sector).toLocaleLowerCase("ar").includes(search);
    return matchesSearch;
  });

  if (state.loadError) {
    return `<div class="empty-state"><strong>تعذر تحميل الخدمات</strong><p>${escapeHTML(state.loadError)}</p><button class="btn btn-outline" data-action="reload">إعادة المحاولة</button></div>`;
  }

  if (!filtered.length) {
    return '<div class="empty-state"><strong>لا توجد خدمات مطابقة</strong><p>غيّر كلمة البحث أو ارجع لاحقًا لمشاهدة الخدمات الجديدة.</p></div>';
  }

  return filtered.map((item) => {
    const canOrder = canRequestService(item);
    const iconBySector = SECTORS.find((sector) => sector.code === item.sector)?.icon ?? "✦";
    const action = canOrder ? "request-service" : (item.sector === "clinic" ? "clinic-info" : "coming-soon");
    const buttonText = canOrder ? "اطلب الخدمة" : (item.sector === "clinic" ? "الحجز قيد التجهيز" : "قريبًا");
    const price = formatEGP(item.price_egp);

    return `
      <article class="service-card" data-sector-card="${escapeHTML(item.sector)}">
        <div class="service-icon">${iconBySector}</div>
        <div class="service-content">
          <span class="eyebrow">${escapeHTML(sectorLabel(item.sector))}</span>
          <h3>${escapeHTML(item.name)}</h3>
          <div class="service-bottom">
            <strong class="price">${escapeHTML(price)}</strong>
            <button class="btn ${canOrder ? "btn-primary" : "btn-muted"} btn-small"
              data-action="${action}" data-item-id="${Number(item.id)}" ${canOrder ? "" : "aria-disabled=\"true\""}>
              ${buttonText}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function homeView() {
  return `
    <section class="hero">
      <div class="hero-copy">
        <span class="hero-kicker">وصلة · رفيقك في رحلته</span>
        <h1>خدمات مدينتك،<br><em>في مكان واحد.</em></h1>
        <p>ابدأ بالخدمة التي تحتاجها. نعرض الخدمات الفعلية المسجلة، ونوضح ما لم يكتمل تشغيله بعد.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#services">استكشف الخدمات <span>←</span></a>
          ${(!state.user || state.profile?.role === "customer") ? '<button class="btn btn-glass" data-action="orders">تابع طلباتك</button>' : ""}
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="hero-logo"><span class="hero-monogram">W</span><span class="hero-wordmark">WASLA</span><span class="hero-arabic">كل اللي محتاجه، قريب منك.</span></div>
        <span class="float-icon float-one">🩺</span><span class="float-icon float-two">🚗</span><span class="float-icon float-three">🧰</span>
      </div>
      <div class="hero-location">📍 شبين القناطر · القليوبية</div>
    </section>

    ${offerTicker()}
    ${renderRoadmapHome(state.roadmapItems, state.roadmapError, !state.roadmapLoaded)}

    <section class="section-block">
      <div class="section-heading">
        <div><span class="eyebrow">كل احتياجاتك</span><h2>قطاعات وصلة</h2></div>
        <span class="section-aside">الخدمات تتفعل تدريجيًا</span>
      </div>
      <div class="sector-grid">${sectorCards()}</div>
    </section>

    <section class="section-block" id="services">
      <div class="section-heading">
        <div><span class="eyebrow">من قاعدة البيانات</span><h2>الخدمات المتاحة حاليًا</h2></div>
        <span class="live-indicator"><i></i> بيانات مباشرة</span>
      </div>
      <label class="search-box">
        <span aria-hidden="true">⌕</span>
        <input data-search type="search" value="${escapeHTML(state.search)}" placeholder="ابحث عن خدمة..." autocomplete="off">
      </label>
      <div class="service-grid">${serviceCards()}</div>
    </section>

    <section class="trust-strip">
      <div><strong>بيانات واضحة</strong><span>لا نعرض مقدم خدمة تجريبيًا كأنه معتمد فعليًا.</span></div>
      <div><strong>تتبع الطلب</strong><span>سجل الطلبات متاح بعد تسجيل الدخول.</span></div>
      <div><strong>صلاحيات محمية</strong><span>التحقق من الصلاحيات يتم في قاعدة البيانات.</span></div>
    </section>
  `;
}

function orderTrackingPanel(order) {
  if (state.trackingOrderId !== order.id) return "";
  if (state.trackingLoadingId === order.id) {
    return '<div class="order-tracking-panel" role="status">جارٍ تحميل سجل الطلب...</div>';
  }
  const tracking = state.orderTracking;
  if (!tracking) {
    return '<div class="order-tracking-panel">تعذر تحميل تفاصيل المتابعة. حاول مرة أخرى.</div>';
  }
  const events = Array.isArray(tracking.events) ? tracking.events : [];
  const queue = tracking.sector === "clinic" && tracking.scheduled_at && Number.isFinite(Number(tracking.queue_position))
    ? `<p class="tracking-queue">ترتيبك في الدور: ${Number(tracking.queue_position)} · أمامك ${Number(tracking.ahead_count) || 0}</p>`
    : "";
  return `
    <section class="order-tracking-panel" aria-label="تفاصيل متابعة الطلب">
      <div class="tracking-summary"><strong>الحالة الحالية</strong><span>${escapeHTML(statusLabel(tracking.status))}</span></div>
      ${tracking.scheduled_at ? `<p class="tracking-schedule">الموعد: ${escapeHTML(formatDate(tracking.scheduled_at))}</p>` : ""}
      ${queue}
      <strong class="tracking-heading">سجل التحديثات</strong>
      ${events.length
        ? `<ol class="order-tracking-list">${events.map((entry) => `<li><span>${escapeHTML(statusLabel(entry.status))}</span><time>${escapeHTML(formatDate(entry.at))}</time></li>`).join("")}</ol>`
        : '<p class="tracking-empty">لم تُسجل تحديثات إضافية بعد.</p>'}
    </section>
  `;
}

function orderItemName(order) {
  const item = order.item_id == null ? null : state.services.find((service) => String(service.id) === String(order.item_id));
  const sector = sectorLabel(order.sector);
  if (order.product_id != null) {
    const product = (state.products || []).find((entry) => String(entry.id) === String(order.product_id));
    const cat = order.product_category || product?.category;
    const label = cat === "food" ? "المطعم" : cat === "supplies" ? "مستلزمات طبية" : sector;
    return `${label} · ${product?.name || "منتج"} × ${Number(order.quantity) || 1}`;
  }
  return item?.name ? `${sector} · ${item.name}` : sector;
}

function orderCard(order) {
  const price = order.price_egp === null ? (order.status === "quoted" ? "بانتظار موافقتك" : "السعر لم يحدد") : formatEGP(order.price_egp);
  return `
    <article class="order-card" id="order-${escapeHTML(order.id)}">
      <div class="order-card-top"><strong>${escapeHTML(order.ref || "طلب وصلة")}</strong><span class="status-pill">${escapeHTML(statusLabel(order.status))}</span></div>
      <div class="order-name">${escapeHTML(orderItemName(order))}</div>
      <div class="order-meta"><span>${escapeHTML(formatDate(order.created_at))}</span><strong>${escapeHTML(price)}</strong></div>
      ${order.scheduled_at ? `<div class="order-meta"><span>الموعد المؤكد: ${escapeHTML(formatAppointment(order.scheduled_at))}</span></div>` : ""}
      ${order.preferred_at && !order.scheduled_at ? `<div class="order-meta"><span>الموعد المقترح منك: ${escapeHTML(formatAppointment(order.preferred_at))} (مقترح فقط، لسه متأكدش)</span></div>` : ""}
      ${order.status === "quoted" ? `<div class="quote-box"><strong>عرض سعر: ${escapeHTML(formatEGP(order.quote_price_egp))}</strong><p>هذا السعر المقترح من فريق وصلة. لن يبدأ التنفيذ ولن يُسجل أي التزام إلا بعد موافقتك. لا يتم تحصيل أي مبلغ داخل وصلة.</p><div class="order-card-actions"><button class="btn btn-primary btn-small" data-action="respond-quote" data-decision="accept" data-order-id="${escapeHTML(order.id)}" data-version="${escapeHTML(order.quote_version)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>أوافق على السعر</button><button class="btn btn-outline btn-small" data-action="respond-quote" data-decision="decline" data-order-id="${escapeHTML(order.id)}" data-version="${escapeHTML(order.quote_version)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>أرفض وألغي الطلب</button></div></div>` : ""}
      ${Number(order.deposit_egp) > 0 ? `<p class="deposit-note">عربون مسجل: ${escapeHTML(formatEGP(order.deposit_egp))} · ${order.deposit_paid ? "مدفوع" : "غير مسدد"}</p>` : ""}
      ${order.lat != null && order.lng != null && Number.isFinite(Number(order.lat)) && Number.isFinite(Number(order.lng)) ? '<p class="location-note">📍 تم تسجيل إحداثيات موقع التنفيذ</p>' : ""}
      ${changeRequestPanel(order)}
      <div class="order-card-actions">
        <button class="btn btn-outline btn-small" data-action="track-order" data-order-id="${escapeHTML(order.id)}" ${state.trackingLoadingId === order.id ? "disabled" : ""}>${state.trackingOrderId === order.id ? "إخفاء التفاصيل" : "متابعة الطلب"}</button>
        ${order.status === "new" ? `<button class="btn btn-outline btn-small" data-action="customer-cancel-order" data-order-id="${escapeHTML(order.id)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>إلغاء الطلب قبل التأكيد</button>` : ""}
      </div>
      ${orderTrackingPanel(order)}
    </article>
  `;
}

const CHANGE_STATUS_LABEL = { open: "طلبك مفتوح، لسه ماتراجعش", applied: "تم التنفيذ", declined: "تمت المراجعة بدون تغيير" };
const CHANGE_KIND_LABEL = { change_time: "تغيير الموعد", cancel: "إلغاء الزيارة" };

function changeRequestPanel(order) {
  if (order.sector !== "nursing" || !["confirmed", "in_progress"].includes(order.status)) return "";
  const mine = (state.changeRequests || []).filter((r) => r.order_id === order.id);
  const open = mine.filter((r) => r.status === "open");
  const lines = mine.slice(0, 4).map((r) => `<p class="deposit-note change-${escapeHTML(r.status)}"><strong>${escapeHTML(CHANGE_KIND_LABEL[r.kind] || r.kind)}:</strong> ${escapeHTML(CHANGE_STATUS_LABEL[r.status] || r.status)}${r.status === "declined" ? " (الطلب زي ما هو)" : ""}</p>`).join("");
  const kinds = [["cancel", "طلب إلغاء الزيارة"]];
  if (order.status === "confirmed") kinds.unshift(["change_time", "طلب تغيير الموعد"]);
  const available = kinds.filter(([k]) => !open.some((r) => r.kind === k));
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const form = available.length ? `
    <form class="change-request-form" data-form="order-change-request" data-order-id="${escapeHTML(order.id)}" novalidate>
      <label>نوع الطلب<select name="kind">${available.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label>ملاحظة (اختياري)<input name="note" maxlength="300"></label>
      <p class="deposit-note">ده طلب بس. الطلب مش بيتغير أو يتلغي إلا لما فريق وصلة يراجعه ويأكد معاك.</p>
      <button class="btn btn-outline btn-small" type="submit" ${disabled}>إرسال الطلب</button>
    </form>` : "";
  return `<div class="change-requests">${lines}${form}</div>`;
}

function formatAppointment(value) {
  try {
    return new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch { return String(value); }
}

function cairoDay(offsetDays) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));
  return parts;
}

/** In-app reminder only (free). No SMS or push is sent. */
function appointmentAlert() {
  const now = Date.now();
  const upcoming = (state.myOrders || [])
    .filter((o) => o.sector === "clinic" && o.scheduled_at && ["new", "confirmed"].includes(o.status))
    .map((o) => ({ o, t: new Date(o.scheduled_at).getTime() }))
    .filter((x) => x.t > now && x.t - now <= 24 * 3600 * 1000)
    .sort((a, b) => a.t - b.t);
  if (!upcoming.length) return "";
  const first = upcoming[0].o;
  return `<div class="notice appointment-alert" role="status"><strong>تذكير بموعدك:</strong> ${escapeHTML(formatAppointment(first.scheduled_at))} · ${escapeHTML(statusLabel(first.status))}. هذا تنبيه داخل التطبيق فقط.</div>`;
}

function clinicSection() {
  if (!Array.isArray(state.doctors) || !state.doctors.length) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const slotOptions = state.clinicSlots.length
    ? state.clinicSlots.map((slot) => `<option value="${escapeHTML(slot)}">${escapeHTML(formatAppointment(slot))}</option>`).join("")
    : "";
  return `
    <section class="page-panel clinic-panel" id="clinic">
      <div class="section-heading"><div><span class="eyebrow">العيادات</span><h2>احجز موعد كشف</h2></div></div>
      <p>اختر الطبيب واليوم ثم الموعد. الطبيب يؤكد الموعد، ولا يتم تحصيل أي مبلغ داخل وصلة. لا تكتب بيانات صحية حساسة في الملاحظات.</p>
      <form data-form="clinic-book" novalidate>
        <label>الطبيب<select name="doctor" data-clinic-pick="doctor" required>
          <option value="">اختر الطبيب</option>
          ${state.doctors.map((d) => `<option value="${escapeHTML(d.id)}" ${d.id === state.clinicDoctorId ? "selected" : ""}>${escapeHTML(d.display_name)}${d.specialty ? " · " + escapeHTML(d.specialty) : ""}</option>`).join("")}
        </select></label>
        <label>اليوم<input type="date" name="day" data-clinic-pick="day" value="${escapeHTML(state.clinicDay)}" min="${cairoDay(0)}" max="${cairoDay(30)}" required></label>
        <label>الموعد<select name="slot" required>
          <option value="">${state.clinicDoctorId ? (state.clinicSlots.length ? "اختر الموعد" : "لا توجد مواعيد في هذا اليوم") : "اختر الطبيب أولًا"}</option>
          ${slotOptions}
        </select></label>
        <label>ملاحظات (اختياري)<input name="notes" maxlength="300"></label>
        <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
        <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
        <button class="btn btn-primary" type="submit" ${disabled}>احجز الموعد</button>
      </form>
    </section>`;
}

function sessionModeLabel(mode) { return mode === "online" ? "أونلاين" : "حضوري"; }

function safeMeetingUrl(value) {
  const text = String(value || "").trim();
  return /^https:\/\/[^/@\s]+(\/\S*)?$/.test(text) && text.length <= 300 ? text : "";
}

async function loadSessionLinks() {
  try { state.sessionLinks = await dataApi.getSessionLinks(); } catch { state.sessionLinks = {}; }
}

function educationSection() {
  if (!Array.isArray(state.sessions) || (!state.sessions.length && !(state.enrollments || []).length)) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const liveEnrollments = (state.enrollments || []).filter((e) => e.status === "booked" && e.session?.title);
  const enrolledIds = new Set(liveEnrollments.map((e) => e.session_id));
  const open = state.sessions.map((item) => `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(item.title)}</strong><span class="status-pill">${escapeHTML(sessionModeLabel(item.mode))}</span></div>
      <div class="order-name">${escapeHTML(item.subject)} · ${escapeHTML(item.teacher?.display_name || "مدرس")}</div>
      ${item.course_id ? `<p class="deposit-note">ضمن الدورة: ${escapeHTML(item.course?.title || "")}. الحجز لمن سجل في الدورة فقط.</p>` : ""}
      <div class="order-meta"><span>${escapeHTML(formatAppointment(item.starts_at))} · ${escapeHTML(item.duration_min)} دقيقة</span>${item.course_id ? "" : `<strong>${escapeHTML(formatEGP(item.price_egp))}</strong>`}</div>
      ${item.course_id ? "" : '<p class="deposit-note">يُدفع للمدرس مباشرة. لا يتم تحصيل أي مبلغ داخل وصلة.</p>'}
      <div class="order-card-actions">${enrolledIds.has(item.id)
        ? '<span class="status-pill">أنت مسجل</span>'
        : `<button class="btn btn-primary btn-small" data-action="enroll-session" data-session-id="${escapeHTML(item.id)}" ${disabled}>سجل في الحصة</button>`}</div>
    </article>`).join("");
  const mine = liveEnrollments.map((e) => `
    <article class="order-card" id="session-${escapeHTML(e.session_id)}">
      <div class="order-card-top"><strong>${escapeHTML(e.session?.title || "حصة")}</strong><span class="status-pill">مسجل</span></div>
      <div class="order-meta"><span>${escapeHTML(e.session?.starts_at ? formatAppointment(e.session.starts_at) : "")}</span></div>
      ${e.status === "booked" && safeMeetingUrl(state.sessionLinks?.[e.session_id]) ? `<p class="deposit-note">الرابط من المدرس ويفتح خدمة خارج وصلة.</p><div class="order-card-actions"><a class="btn btn-primary btn-small session-link" href="${escapeHTML(safeMeetingUrl(state.sessionLinks[e.session_id]))}" target="_blank" rel="noopener noreferrer">فتح رابط الحصة</a></div>` : ""}
      <div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="cancel-enrollment" data-enrollment-id="${escapeHTML(e.id)}" ${disabled}>إلغاء التسجيل</button></div>
    </article>`).join("");
  return `
    <section class="page-panel education-panel" id="education">
      <div class="section-heading"><div><span class="eyebrow">التعليم</span><h2>حصص ودروس</h2></div></div>
      <p>التسجيل يتطلب موافقتك على الشروط والخصوصية. الإلغاء متاح قبل الحصة بساعتين على الأقل.</p>
      ${mine ? `<h3>تسجيلاتي</h3><div class="orders-list">${mine}</div>` : ""}
      ${open ? `<h3>حصص متاحة</h3><div class="orders-list">${open}</div>` : '<p class="tracking-empty">لا توجد حصص متاحة الآن.</p>'}
    </section>`;
}

async function loadMedicalNotes() {
  state.medicalNotes = null;
  try { state.medicalNotes = await dataApi.getMedicalNotes(); } catch { state.medicalNotes = null; }
}

const NOTIFICATION_TEXT = {
  order_status: "حالة طلبك اتغيرت. افتح الطلب لتشوف التفاصيل.",
  order_scheduled: "موعد طلبك اتحدد أو اتغير. افتح الطلب لتشوف الموعد.",
  change_request_applied: "تم تنفيذ طلبك.",
  change_request_declined: "تمت مراجعة طلبك بدون تغيير.",
  delivery_status: "حالة طلب التوصيل اتغيرت.",
  prescription_quote: "وصلك رد جديد على أحد طلباتك.",
  prescription_quote_revised: "تم تعديل رد على أحد طلباتك.",
  session_cancelled: "تم إلغاء إحدى حصصك.",
  session_link: "المدرس أضاف أو غيّر رابط إحدى حصصك."
};

const NOTIFICATION_TARGET = {
  delivery_status: "delivery",
  prescription_quote: "rx",
  prescription_quote_revised: "rx",
  session_cancelled: "session",
  session_link: "session"
};

function notificationTargetLabel(n) {
  const type = NOTIFICATION_TARGET[n.kind];
  if (type === "delivery") return (state.deliveries || []).find((d) => d.id === n.ref_id)?.ref || "";
  if (type === "rx") { const r = (state.prescriptions || []).find((x) => x.id === n.ref_id); return r?.created_at ? `طلب ${formatDate(r.created_at)}` : ""; }
  if (type === "session") return (state.enrollments || []).find((e) => e.session_id === n.ref_id)?.session?.title || "";
  return "";
}

function notificationItem(n) {
  const order = (state.myOrders || []).find((o) => o.id === n.ref_id);
  const targetType = NOTIFICATION_TARGET[n.kind];
  const targetLabel = targetType ? notificationTargetLabel(n) : "";
  const opaque = n.ref_id ? `#${String(n.ref_id).slice(0, 4).toUpperCase()}` : "";
  const ref = order ? escapeHTML(order.ref || "") : escapeHTML(targetLabel || (targetType ? opaque : ""));
  return `<article class="order-card${n.read_at ? "" : " notification-unread"}"><div class="order-card-top"><strong>${escapeHTML(NOTIFICATION_TEXT[n.kind])}</strong>${ref ? `<span class="status-pill">${ref}</span>` : ""}</div><div class="order-meta"><span>${escapeHTML(formatDate(n.created_at))}</span>${order ? `<button class="btn btn-outline btn-small" data-action="open-notification-order" data-order-id="${escapeHTML(order.id)}">فتح الطلب</button>` : ""}${targetType ? `<button class="btn btn-outline btn-small" data-action="open-notification-target" data-target-type="${targetType}" data-target-id="${escapeHTML(n.ref_id)}" data-kind="${escapeHTML(n.kind)}">فتح</button>` : ""}</div></article>`;
}

function notificationsSection() {
  const list = (state.notifications || []).filter((n) => NOTIFICATION_TEXT[n.kind]);
  if (!list.length) return "";
  const unread = list.filter((n) => !n.read_at).length;
  return `
    <div class="notifications-box" id="my-notifications">
      <div class="section-heading"><div><span class="eyebrow">تنبيهات</span><h2>آخر التنبيهات${unread ? ` <span class="badge-count">${unread} جديد</span>` : ""}</h2></div></div>
      ${unread ? '<button class="btn btn-outline btn-small" data-action="mark-notifications-read">تمت قراءة الكل</button>' : ""}
      <div class="orders-list">${list.slice(0, 8).map((n) => `${notificationItem(n)}`).join("")}</div>
    </div>`;
}

function medicalNotesSection() {
  const data = state.medicalNotes;
  if (!data) return "";
  const isDoctor = state.providerRecord?.kind === "doctor";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const list = (data.notes || []).map((n) => `
    <article class="order-card"><div class="order-card-top"><strong>${escapeHTML(n.note)}</strong></div>
      <div class="order-meta"><span>${escapeHTML(formatDate(n.created_at))}</span></div></article>`).join("");
  if (isDoctor) {
    const options = (data.targets || []).map((o) => `<option value="${escapeHTML(o.id)}">${escapeHTML(o.ref || o.id.slice(0, 8))}</option>`).join("");
    return `
    <section class="page-panel health-panel" id="doctor-notes">
      <div class="section-heading"><div><span class="eyebrow">السجل الطبي</span><h2>ملاحظات الحالات</h2></div></div>
      <p class="deposit-note">الملاحظة تظهر للمريض صاحب الحالة فقط. لا تكتب بيانات هوية أو أرقام تواصل.</p>
      ${options ? `<form data-form="doctor-note" novalidate>
        <label>الحالة<select name="order" required>${options}</select></label>
        <label>الملاحظة<textarea name="note" rows="3" maxlength="2000" required></textarea></label>
        <button class="btn btn-primary btn-small" type="submit" ${disabled}>حفظ الملاحظة</button>
      </form>` : '<p class="tracking-empty">لا توجد حالات مؤكدة لإضافة ملاحظات عليها.</p>'}
      ${list ? `<div class="orders-list">${list}</div>` : ""}
    </section>`;
  }
  if (!list) return "";
  return `
    <section class="page-panel health-panel" id="my-notes">
      <div class="section-heading"><div><span class="eyebrow">السجل الطبي</span><h2>ملاحظات الطبيب الخاصة بك</h2></div></div>
      <p class="deposit-note">هذه الملاحظات تظهر لك أنت فقط.</p>
      <div class="orders-list">${list}</div>
    </section>`;
}

async function loadCourses() {
  state.courses = null; state.teacherCourses = null; state.tutorProfile = null;
  try { state.courses = await dataApi.getCourses(); } catch { state.courses = null; }
  state.courseEnrollments = null;
  try { state.courseEnrollments = await dataApi.getCourseEnrollments(); } catch { state.courseEnrollments = null; }
  const teacher = state.providerRecord;
  if (state.profile?.role === "teacher" && teacher?.id) {
    try { state.teacherCourses = await dataApi.getCourses(teacher.id); state.tutorProfile = await dataApi.getMyTutorProfile(teacher.id); } catch { state.teacherCourses = null; }
  }
}

function courseCard(item, extra = "") {
  return `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(item.title)}</strong><span class="status-pill">${escapeHTML(sessionModeLabel(item.mode))}</span></div>
      <div class="order-name">${escapeHTML(item.subject)}${item.teacher?.display_name ? ` · ${escapeHTML(item.teacher.display_name)}` : ""}</div>
      ${item.description ? `<p class="deposit-note">${escapeHTML(item.description)}</p>` : ""}
      <div class="order-meta"><span>${escapeHTML(item.lessons)} حصة</span><strong>${item.price_egp ? escapeHTML(formatEGP(item.price_egp)) : "مجانية"}</strong></div>
      ${extra}
    </article>`;
}

function courseEnrollButton(course) {
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const mine = (state.courseEnrollments || []).find((e) => e.course_id === course.id && e.status === "booked");
  const seats = `<span class="status-pill">${escapeHTML(course.seats)} مقعد</span>`;
  if (mine) return `<div class="order-card-actions">${seats}<button class="btn btn-outline btn-small" data-action="cancel-course-enrollment" data-enrollment-id="${escapeHTML(mine.id)}" ${disabled}>إلغاء التسجيل</button></div>`;
  return `<div class="order-card-actions">${seats}<button class="btn btn-primary btn-small" data-action="enroll-course" data-course-id="${escapeHTML(course.id)}" ${disabled}>سجل في الدورة</button></div>`;
}

function courseCatalogueSection() {
  if (!Array.isArray(state.courses) || !state.courses.length || state.profile?.role === "teacher") return "";
  const booked = (state.courseEnrollments || []).filter((e) => e.status === "booked").length;
  const mineCourses = booked ? `<p class="deposit-note">أنت مسجل في ${escapeHTML(booked)} دورة.</p>` : "";
  return `
    <section class="page-panel health-panel education-panel" id="course-catalogue">
      <div class="section-heading"><div><span class="eyebrow">التعليم</span><h2>الدورات المتاحة</h2></div></div>
      <p class="deposit-note">الاتفاق والدفع مع المدرس مباشرة. لا يتم تحصيل أي مبلغ داخل وصلة.</p>
      ${mineCourses}
      <div class="orders-list">${state.courses.map((c) => courseCard(c, courseEnrollButton(c))).join("")}</div>
    </section>`;
}

function teacherCatalogueSection() {
  if (state.profile?.role !== "teacher" || !Array.isArray(state.teacherCourses)) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const p = state.tutorProfile || {};
  const cards = state.teacherCourses.map((c) => courseCard(c, `<div class="order-card-actions"><span class="status-pill">${c.active ? "ظاهرة للطلاب" : "مخفية"}</span><span class="status-pill">${(state.courseEnrollments || []).filter((e) => e.course_id === c.id && e.status === "booked").length} من ${escapeHTML(c.seats)} مسجلين</span><button class="btn btn-outline btn-small" data-action="toggle-course" data-course-id="${escapeHTML(c.id)}" data-active="${c.active ? "no" : "yes"}" ${disabled}>${c.active ? "إخفاء" : "إظهار"}</button></div>`)).join("");
  return `
    <section class="page-panel health-panel education-panel" id="teacher-catalogue">
      <div class="section-heading"><div><span class="eyebrow">مساحة المدرس</span><h2>ملفي ودوراتي</h2></div></div>
      <form data-form="teacher-profile" novalidate>
        <label>العنوان التعريفي<input name="headline" maxlength="100" value="${escapeHTML(p.headline || "")}" required></label>
        <label>نبذة (اختياري)<textarea name="bio" rows="3" maxlength="1000">${escapeHTML(p.bio || "")}</textarea></label>
        <label>المواد (افصل بفاصلة)<input name="subjects" maxlength="200" value="${escapeHTML((p.subjects || []).join("، "))}"></label>
        <button class="btn btn-outline btn-small" type="submit" ${disabled}>حفظ الملف</button>
      </form>
      <form data-form="teacher-course" novalidate>
        <label>عنوان الدورة<input name="title" maxlength="120" required></label>
        <label>المادة<input name="subject" maxlength="60" required></label>
        <label>وصف (اختياري)<textarea name="description" rows="3" maxlength="1000"></textarea></label>
        <label>عدد الحصص<input type="number" name="lessons" min="1" max="200" required></label>
        <label>النوع<select name="mode"><option value="online">أونلاين</option><option value="in_person">حضوري</option></select></label>
        <label>السعر بالجنيه (اختياري، يُدفع للمدرس مباشرة)<input type="number" name="price" min="0" max="20000"></label>
        <label>عدد المقاعد<input type="number" name="seats" min="1" max="200" value="20"></label>
        <button class="btn btn-primary btn-small" type="submit" ${disabled}>أضف الدورة</button>
      </form>
      ${cards ? `<div class="orders-list">${cards}</div>` : '<p class="tracking-empty">لا توجد دورات بعد.</p>'}
    </section>`;
}

async function loadHealthWork() {
  await loadCourses();
  await loadMedicalNotes();
  const provider = state.providerRecord;
  state.healthWork = null;
  state.merchantProducts = null;
  if (provider?.id && provider.kind === "merchant") {
    try { state.merchantProducts = await dataApi.getMyProducts(provider.id); } catch { state.merchantProducts = null; }
  }
  if (!provider?.id || provider.kind !== "merchant") return;
  try { state.healthWork = await dataApi.getProviderHealthWorkspace(provider); } catch { state.healthWork = null; }
}

const PRODUCT_CATEGORY_LABELS = { market: "ماركت", food: "مطعم", supplies: "مستلزمات طبية" };

function merchantProductsSection() {
  if (!Array.isArray(state.merchantProducts) || state.profile?.role !== "merchant") return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const rows = state.merchantProducts.map((p) => `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(p.name)}</strong><span class="status-pill">${p.active ? "ظاهر للعملاء" : "مخفي"}</span></div>
      <div class="order-meta"><span>${escapeHTML(PRODUCT_CATEGORY_LABELS[p.category] || p.category)} · المخزون ${escapeHTML(p.stock)}</span><strong>${escapeHTML(formatEGP(p.price_egp))}</strong></div>
      <form data-form="product-edit" data-product-id="${escapeHTML(p.id)}" novalidate>
        <label>الاسم<input name="name" maxlength="120" value="${escapeHTML(p.name)}" required></label>
        <label>التصنيف<select name="category">${Object.entries(PRODUCT_CATEGORY_LABELS).map(([k, v]) => `<option value="${k}" ${k === p.category ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>السعر بالجنيه<input type="number" name="price" min="1" max="100000" value="${escapeHTML(p.price_egp)}" required></label>
        <div class="order-card-actions"><button class="btn btn-outline btn-small" type="submit" ${disabled}>حفظ الاسم والسعر والتصنيف</button></div>
      </form>
      <form data-form="product-stock" data-product-id="${escapeHTML(p.id)}" novalidate>
        <label>المخزون<input type="number" name="stock" min="0" max="10000" value="${escapeHTML(p.stock)}" required></label>
        <div class="order-card-actions"><button class="btn btn-outline btn-small" type="submit" ${disabled}>حفظ المخزون</button><button class="btn btn-outline btn-small" type="button" data-action="toggle-product" data-product-id="${escapeHTML(p.id)}" data-active="${p.active ? "no" : "yes"}" ${disabled}>${p.active ? "إخفاء" : "إظهار"}</button></div>
      </form>
    </article>`).join("");
  return `
    <section class="page-panel health-panel" id="merchant-products">
      <div class="section-heading"><div><span class="eyebrow">التاجر</span><h2>منتجاتي</h2></div></div>
      <p class="deposit-note">أنت تحدد الاسم والسعر والمخزون. الدفع عند الاستلام ولا يتم تحصيل أي مبلغ داخل وصلة.</p>
      <form data-form="product-add" novalidate>
        <label>اسم المنتج<input name="name" maxlength="120" required></label>
        <label>التصنيف<select name="category" required><option value="market">ماركت</option><option value="food">مطعم</option><option value="supplies">مستلزمات طبية</option></select></label>
        <label>السعر بالجنيه<input type="number" name="price" min="1" max="100000" required></label>
        <label>المخزون<input type="number" name="stock" min="0" max="10000" value="1" required></label>
        <button class="btn btn-primary" type="submit" ${disabled}>أضف المنتج</button>
      </form>
      ${rows ? `<div class="orders-list">${rows}</div>` : '<p class="tracking-empty">لا توجد منتجات بعد.</p>'}
    </section>`;
}

function healthProviderSection() {
  const work = state.healthWork;
  if (!work) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  if (work.kind === "pharmacy") {
    const cards = (work.requests || []).map((r) => {
      const mine = (r.quotes || [])[0];
      return `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(r.note)}</strong><span class="status-pill">${escapeHTML(prescriptionStatusLabel(r.status))}</span></div>
      ${r.attachment_path ? `<div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="open-rx-file" data-path="${escapeHTML(r.attachment_path)}" ${disabled}>عرض صورة الروشتة</button></div>` : ""}
      ${mine ? `<div class="order-meta"><span>ردك: ${mine.delivery_available ? "توصيل" : "استلام"}${mine.eta_minutes ? ` · ${escapeHTML(mine.eta_minutes)} دقيقة` : ""}</span><strong>${escapeHTML(formatEGP(mine.price_egp))}</strong></div>` : ""}
      <form data-form="pharmacy-quote" data-request-id="${escapeHTML(r.id)}" novalidate>
        <label>السعر الإجمالي بالجنيه<input type="number" name="price" min="1" max="20000" required></label>
        <label>ملاحظة (اختياري)<input name="note" maxlength="300"></label>
        <label class="check-row"><input type="checkbox" name="delivery" value="yes"> متاح توصيل</label>
        <label>مدة التوصيل بالدقائق (اختياري)<input type="number" name="eta" min="5" max="2880"></label>
        <button class="btn btn-primary btn-small" type="submit" ${disabled}>${mine ? "حدّث الرد" : "أرسل الرد"}</button>
      </form>
    </article>`;
    }).join("");
    return `
    <section class="page-panel health-panel" id="pharmacy-work">
      <div class="section-heading"><div><span class="eyebrow">الصيدلية</span><h2>طلبات الأدوية الموجهة لك</h2></div></div>
      <p class="deposit-note">تظهر لك فقط الطلبات التي اختارك العميل لها. لا تشارك أي بيانات من الروشتة خارج هذا الرد. السعر والدفع بينك وبين العميل مباشرة.</p>
      ${cards ? `<div class="orders-list">${cards}</div>` : '<p class="tracking-empty">لا توجد طلبات موجهة لك الآن.</p>'}
    </section>`;
  }
  const kindLabel = work.kind === "radiology" ? "الأشعة" : "التحاليل";
  const rows = (work.tests || []).map((t) => `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(t.name)}</strong><span class="status-pill">${t.active ? "ظاهر للعملاء" : "مخفي"}</span></div>
      <div class="order-meta"><span></span><strong>${escapeHTML(formatEGP(t.price_egp))}</strong></div>
      <div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="toggle-lab-test" data-test-id="${escapeHTML(t.id)}" data-active="${t.active ? "no" : "yes"}" ${disabled}>${t.active ? "إخفاء" : "إظهار"}</button></div>
    </article>`).join("");
  return `
    <section class="page-panel health-panel" id="lab-work">
      <div class="section-heading"><div><span class="eyebrow">${kindLabel}</span><h2>قائمة أسعار ${kindLabel}</h2></div></div>
      <form data-form="lab-test" data-kind="${escapeHTML(work.kind)}" novalidate>
        <label>الاسم<input name="name" maxlength="120" required></label>
        <label>السعر بالجنيه<input type="number" name="price" min="1" max="20000" required></label>
        <button class="btn btn-primary" type="submit" ${disabled}>أضف أو حدّث السعر</button>
      </form>
      ${rows ? `<div class="orders-list">${rows}</div>` : '<p class="tracking-empty">لا توجد أسعار بعد.</p>'}
    </section>`;
}

function labPriceSection() {
  if (!Array.isArray(state.labTests) || !state.labTests.length) return "";
  const rows = state.labTests.map((t) => `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(t.name)}</strong><span class="status-pill">${t.kind === "radiology" ? "أشعة" : "تحليل"}</span></div>
      <div class="order-meta"><span>${escapeHTML(t.provider?.display_name || "")}</span><strong>${escapeHTML(formatEGP(t.price_egp))}</strong></div>
    </article>`).join("");
  return `
    <section class="page-panel health-panel" id="lab-prices">
      <div class="section-heading"><div><span class="eyebrow">الصحة</span><h2>أسعار التحاليل والأشعة</h2></div></div>
      <p class="deposit-note">الأسعار يحددها كل معمل أو مركز. لا يتم تحصيل أي مبلغ داخل وصلة.</p>
      <div class="orders-list">${rows}</div>
    </section>`;
}

function prescriptionStatusLabel(status) {
  return status === "answered" ? "تم الرد" : status === "open" ? "بانتظار الردود" : "مغلق";
}

function prescriptionSection() {
  if (!Array.isArray(state.prescriptions)) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const pharmacies = Array.isArray(state.pharmacies) ? state.pharmacies : [];
  const cards = state.prescriptions.map((r) => {
    const quotes = (r.quotes || []).map((q) => `
      <div class="order-meta"><span>${escapeHTML(q.pharmacy?.display_name || "صيدلية")}${q.delivery_available ? ` · توصيل${q.eta_minutes ? ` خلال ${escapeHTML(q.eta_minutes)} دقيقة` : ""}` : " · استلام من الصيدلية"}${q.note ? ` · ${escapeHTML(q.note)}` : ""}</span><strong>${escapeHTML(formatEGP(q.price_egp))}</strong></div>`).join("");
    return `
    <article class="order-card" id="rx-${escapeHTML(r.id)}">
      <div class="order-card-top"><strong>${escapeHTML(r.note)}</strong><span class="status-pill">${escapeHTML(prescriptionStatusLabel(r.status))}</span></div>
      ${r.attachment_path ? '<div class="order-meta"><span>مرفق: صورة الروشتة</span></div>' : ""}
      ${quotes || '<p class="tracking-empty">لا توجد ردود بعد.</p>'}
      <div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="close-prescription" data-request-id="${escapeHTML(r.id)}" ${disabled}>إغلاق الطلب وسحب المشاركة</button></div>
    </article>`;
  }).join("");
  const choices = pharmacies.map((p) => `
    <label class="check-row"><input type="checkbox" name="pharmacy" value="${escapeHTML(p.id)}"> ${escapeHTML(p.display_name)}${p.area ? ` · ${escapeHTML(p.area)}` : ""}</label>`).join("");
  return `
    <section class="page-panel health-panel" id="prescriptions">
      <div class="section-heading"><div><span class="eyebrow">الصحة</span><h2>اطلب أدويتك من الصيدليات</h2></div></div>
      <p>اكتب أسماء الأدوية أو ارفع صورة الروشتة، واختر الصيدليات التي تريد أن ترد عليك. لا تراها أي صيدلية غير التي تختارها، ويمكنك إغلاق الطلب وسحب المشاركة في أي وقت. الدفع للصيدلية مباشرة.</p>
      ${pharmacies.length ? `<form data-form="prescription" novalidate>
        <label>الأدوية المطلوبة<textarea name="note" rows="3" maxlength="500" required></textarea></label>
        <label>صورة الروشتة (اختياري، JPG أو PNG أو WebP أو PDF حتى 5 ميجا)<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
        <fieldset><legend>الصيدليات التي سترى طلبك (حتى 5)</legend>${choices}</fieldset>
        <label class="check-row"><input type="checkbox" name="consent" value="yes"> أوافق على مشاركة هذا الطلب والمرفق مع الصيدليات التي اخترتها فقط. الصيدلية قد ترى معلومات صحية تظهر في الروشتة.</label>
        <button class="btn btn-primary" type="submit" ${disabled}>أرسل الطلب</button>
      </form>` : '<p class="tracking-empty">لا توجد صيدليات متاحة الآن.</p>'}
      ${cards ? `<h3>طلباتي</h3><div class="orders-list">${cards}</div>` : ""}
    </section>`;
}

function teacherSection() {
  if (state.profile?.role !== "teacher" || !Array.isArray(state.teacherSessions)) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const courseOptions = (Array.isArray(state.teacherCourses) ? state.teacherCourses : []).filter((c) => c.active).map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.title)}</option>`).join("");
  const cards = state.teacherSessions.map((item) => `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(item.title)}</strong><span class="status-pill">${item.status === "open" ? "مفتوحة" : "ملغاة"}</span></div>
      ${item.course?.title ? `<div class="order-name">ضمن الدورة: ${escapeHTML(item.course.title)}</div>` : ""}
      <div class="order-meta"><span>${escapeHTML(formatAppointment(item.starts_at))} · ${escapeHTML(sessionModeLabel(item.mode))} · ${escapeHTML(item.seats)} مقاعد</span><strong>${escapeHTML(formatEGP(item.price_egp))}</strong></div>
      ${item.status === "open" && item.mode === "online" ? `<form class="session-link-form" data-form="teacher-session-link" data-session-id="${escapeHTML(item.id)}" novalidate>
        <label>رابط الحصة (https، من أي خدمة اجتماعات تستخدمها، يراه المسجلون فقط)<input name="url" type="url" inputmode="url" maxlength="300" dir="ltr" value="${escapeHTML(safeMeetingUrl(state.sessionLinks?.[item.id]))}" placeholder="https://"></label>
        <button class="btn btn-outline btn-small" type="submit" ${disabled}>حفظ الرابط</button>
      </form>` : ""}
      ${item.status === "open" ? `<div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="teacher-cancel-session" data-session-id="${escapeHTML(item.id)}" ${disabled}>إلغاء الحصة</button></div>` : ""}
    </article>`).join("");
  return `
    <section class="page-panel education-panel health-panel" id="teacher-sessions">
      <div class="section-heading"><div><span class="eyebrow">مساحة المدرس</span><h2>حصصي</h2></div></div>
      <form data-form="teacher-session" novalidate>
        <label>عنوان الحصة<input name="title" maxlength="120" required></label>
        <label>المادة<input name="subject" maxlength="60" required></label>
        <label>الموعد<input type="datetime-local" name="starts" required></label>
        <label>النوع<select name="mode"><option value="online">أونلاين</option><option value="in_person">حضوري</option></select></label>
        <label>عدد المقاعد<input type="number" name="seats" min="1" max="30" value="5" required></label>
        <label>السعر بالجنيه (يُدفع مباشرة للمدرس، لا ينطبق على حصص الدورة)<input type="number" name="price" min="0" max="5000" value="0" required></label>
        ${courseOptions ? `<label>الدورة (اختياري)<select name="course"><option value="">حصة مستقلة</option>${courseOptions}</select></label>` : ""}
        <button class="btn btn-primary" type="submit" ${disabled}>أضف الحصة</button>
      </form>
      ${cards ? `<div class="orders-list">${cards}</div>` : '<p class="tracking-empty">لا توجد حصص بعد.</p>'}
    </section>`;
}

function storePanel(category, eyebrow, title, intro) {
  const items = (state.products || []).filter((p) => (p.category || "market") === category);
  if (!items.length) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  return `
    <section class="page-panel store-panel" id="${category === "food" ? "food" : category === "supplies" ? "supplies" : "store"}">
      <div class="section-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div></div>
      <p>${intro} التوصيل مجاني للعميل. الدفع عند الاستلام ولا يتم تحصيل أي مبلغ داخل وصلة. السعر النهائي يحسبه النظام.</p>
      <form data-form="store-order" novalidate>
        <label>${category === "food" ? "الوجبة" : category === "supplies" ? "المستلزم" : "المنتج"}<select name="product" required>
          <option value="">${category === "food" ? "اختر الوجبة" : category === "supplies" ? "اختر المستلزم" : "اختر المنتج"}</option>
          ${items.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${escapeHTML(formatEGP(p.discount_price_egp ?? p.price_egp))} (متوفر ${escapeHTML(p.stock)})</option>`).join("")}
        </select></label>
        <label>الكمية<input type="number" name="qty" min="1" max="20" value="1" required></label>
        <label>عنوان التسليم<input name="address" maxlength="255" required></label>
        <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
        <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
        <button class="btn btn-primary" type="submit" ${disabled}>تأكيد الطلب</button>
      </form>
    </section>`;
}

function nursingSection() {
  if (!Array.isArray(state.nursingItems) || !state.nursingItems.length) return "";
  const disabled = state.busy || CONFIG.isPublicPreview ? "disabled" : "";
  const options = state.nursingItems.map((i) => `<option value="${escapeHTML(i.id)}">${escapeHTML(i.name)} - ${escapeHTML(formatEGP(i.price_egp))}</option>`).join("");
  return `
    <section class="page-panel health-panel" id="nursing">
      <div class="section-heading"><div><span class="eyebrow">الصحة</span><h2>تمريض منزلي</h2></div></div>
      <p class="deposit-note">الطلب يُراجع من فريق وصلة ويُسند لمقدم خدمة معتمد للتمريض فقط. المواعيد والإلغاء بيتم تأكيدها معاك مباشرة بعد التعيين. الدفع عند الزيارة.</p>
      ${state.nursingTimeRetry ? `<div class="deposit-note" role="alert"><strong>طلبك ${escapeHTML(state.nursingTimeRetry.ref || "")} اتسجل، لكن الموعد المقترح ما اتحفظش.</strong> متبعتش الطلب تاني. اختار الموعد من هنا، أو اتخطاه وفريق وصلة هيتواصل معاك.
        <form data-form="nursing-time-retry" novalidate><label>الموعد المقترح (مقترح فقط)<input type="datetime-local" name="preferred_at" required></label>
        <button class="btn btn-primary" type="submit" ${disabled}>احفظ الموعد المقترح</button> <button class="btn btn-outline" type="button" data-action="nursing-time-skip">تخطي</button></form></div>` : ""}
      <form data-form="nursing-request" novalidate ${state.nursingTimeRetry ? 'hidden aria-hidden="true" style="display:none"' : ""}>
        <label>الخدمة<select name="item" required>${options}</select></label>
        <label>عنوان الزيارة<input name="address" maxlength="300" required></label>
        <label>ملاحظات (اختياري)<input name="notes" maxlength="300"></label>
        <label>الموعد المفضل (اختياري، مقترح فقط ولا يتأكد إلا من فريق وصلة)<input type="datetime-local" name="preferred_at"></label>
        <label class="check-row"><input type="checkbox" name="terms" value="yes"><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a> و<a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
        <label class="check-row"><input type="checkbox" name="consent" value="yes"><span>أوافق على استخدام بياناتي الصحية لتنفيذ هذا الطلب فقط.</span></label>
        <button class="btn btn-primary" type="submit" ${disabled}>أرسل طلب التمريض</button>
      </form>
    </section>`;
}

function storeSection() {
  return storePanel("market", "الماركت", "اطلب من الماركت", "منتجات البقالة واحتياجات البيت.")
    + storePanel("food", "المطاعم", "اطلب وجبة", "وجبات من مطاعم شبين القناطر.")
    + storePanel("supplies", "الصحة", "مستلزمات طبية", "كمامات وشاش وأجهزة قياس منزلية.");
}

async function loadClinicSlots() {
  state.clinicSlots = [];
  if (state.clinicDoctorId && state.clinicDay) {
    try { state.clinicSlots = await dataApi.getClinicSlots(state.clinicDoctorId, state.clinicDay); } catch { state.clinicSlots = []; }
  }
}

function deliverySection() {
  if (!Array.isArray(state.deliveries)) return "";
  const cards = state.deliveries.map((item) => `
    <article class="order-card" id="delivery-${escapeHTML(item.id)}">
      <div class="order-card-top"><strong>${escapeHTML(item.ref)}</strong><span class="status-pill">${escapeHTML(statusLabel(item.status))}</span></div>
      <div class="order-name">${escapeHTML(item.what_to_deliver)}</div>
      <div class="order-meta"><span>من: ${escapeHTML(item.pickup_address)}</span></div>
      <div class="order-meta"><span>إلى: ${escapeHTML(item.dropoff_address)}</span></div>
      <div class="order-meta"><span>${escapeHTML(formatDate(item.created_at))}</span><strong>مجاني للعميل</strong></div>
      ${item.status === "new" ? `<div class="order-card-actions"><button class="btn btn-outline btn-small" data-action="customer-cancel-delivery" data-request-id="${escapeHTML(item.id)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>إلغاء الطلب قبل التعيين</button></div>` : ""}
    </article>`).join("");
  return `
    <section class="page-panel delivery-panel">
      <div class="section-heading"><div><span class="eyebrow">توصيل</span><h2>اطلب توصيل</h2></div></div>
      <p>التوصيل مجاني للعميل. لا يتم تحصيل أي مبلغ داخل وصلة، والتنفيذ حسب توفر مندوب.</p>
      <form data-form="delivery-request" novalidate>
        <label>عنوان الاستلام<input name="pickup" maxlength="255" required></label>
        <label>عنوان التسليم<input name="dropoff" maxlength="255" required></label>
        <label>ما الذي سيتم توصيله؟<input name="what" maxlength="300" required></label>
        <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
        <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
        <button class="btn btn-primary" type="submit" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>إرسال طلب التوصيل</button>
      </form>
      ${cards ? `<div class="orders-list">${cards}</div>` : '<p class="tracking-empty">لا توجد طلبات توصيل بعد.</p>'}
    </section>`;
}

function ordersView() {
  if (!state.user) {
    return '<section class="page-panel"><h1>طلباتي</h1><p>سجل الدخول لمشاهدة طلباتك.</p><button class="btn btn-primary" data-action="auth">تسجيل الدخول</button></section>';
  }

  return `
    <section class="page-panel">
      <div class="section-heading"><div><span class="eyebrow">حساب العميل</span><h1>طلباتي</h1></div><button class="btn btn-outline btn-small" data-action="reload-orders">تحديث</button></div>
      ${appointmentAlert()}
      ${notificationsSection()}
      ${state.myOrders.length
        ? `<div class="orders-list">${state.myOrders.map(orderCard).join("")}</div>`
        : '<div class="empty-state"><strong>لا توجد طلبات بعد</strong><p>عندما ترسل أول طلب ستظهر حالته هنا.</p><button class="btn btn-primary" data-action="home">اكتشف الخدمات</button></div>'}
    </section>
    ${clinicSection()}
    ${storeSection()}
    ${educationSection()}
    ${courseCatalogueSection()}
    ${labPriceSection()}
    ${nursingSection()}
    ${prescriptionSection()}
    ${medicalNotesSection()}
    ${deliverySection()}
  `;
}

function deliveryQueueCards(role) {
  return state.deliveryQueue.map((item) => {
    const couriers = (state.operationsProviders || []).filter((p) => p.kind === "courier" && p.approved && p.active && !p.is_test);
    let action = "";
    if (role === "staff" && item.status === "new") {
      action = `<form data-form="delivery-assign" data-request-id="${escapeHTML(item.id)}"><label>المندوب<select name="courier_id" required><option value="">اختر مندوبًا</option>${couriers.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.display_name)}</option>`).join("")}</select></label><button class="btn btn-primary btn-small" type="submit" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>تعيين</button></form>${couriers.length ? "" : '<p class="tracking-empty">لا يوجد مندوب معتمد ونشط.</p>'}`;
    }
    if (role === "courier" && item.status === "assigned") {
      action = `<button class="btn btn-primary btn-small" data-action="courier-delivery" data-to="picked_up" data-request-id="${escapeHTML(item.id)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>تم الاستلام من المرسل</button>`;
    }
    if (role === "courier" && item.status === "picked_up") {
      action = `<button class="btn btn-primary btn-small" data-action="courier-delivery" data-to="delivered" data-request-id="${escapeHTML(item.id)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>تم التسليم</button>`;
    }
    return `<article class="order-card"><div class="order-card-top"><strong>${escapeHTML(item.ref)}</strong><span class="status-pill">${escapeHTML(statusLabel(item.status))}</span></div><div class="order-name">${escapeHTML(item.what_to_deliver)}</div><div class="order-meta"><span>من: ${escapeHTML(item.pickup_address)}</span></div><div class="order-meta"><span>إلى: ${escapeHTML(item.dropoff_address)}</span></div>${action}</article>`;
  }).join("");
}

function deliveryQueueSection(role) {
  if (!Array.isArray(state.deliveryQueue)) return "";
  const cards = deliveryQueueCards(role);
  return `<section class="page-panel delivery-panel"><div class="section-heading"><div><span class="eyebrow">توصيل</span><h2>${role === "staff" ? "طلبات التوصيل" : "توصيلاتي"}</h2></div></div>${cards || '<p class="tracking-empty">لا توجد طلبات توصيل.</p>'}</section>`;
}

function operationsView() {
  return renderOperationsView({
    profile: state.profile,
    orders: state.operationsOrders,
    providers: state.operationsProviders,
    services: state.operationsServices,
    latestInviteCode: state.latestInviteCode,
    coverage: state.operationsCoverage,
    changeRequests: state.opsChangeRequests,
    preview: CONFIG.isPublicPreview,
    saving: state.operationsSaving
  }) + deliveryQueueSection("staff");
}

function crmView() {
  return renderCrmView({
    profile: state.profile,
    metrics: state.crmMetrics,
    providers: state.crmProviders,
    customers: state.crmCustomers,
    leads: state.crmLeads,
    tasks: state.crmTasks,
    tickets: state.crmTickets,
    selectedCustomerId: state.crmSelectedCustomerId,
    customer360: state.crmCustomer360,
    preview: CONFIG.isPublicPreview,
    saving: state.crmSaving,
    error: state.crmError
  });
}


function providerView() {
  return renderProviderView({
    profile: state.profile,
    provider: state.providerRecord,
    orders: state.providerOrders,
    preview: CONFIG.isPublicPreview,
    saving: state.providerSaving,
    error: state.providerError
  }) + (state.profile?.role === "courier" ? deliveryQueueSection("courier") : "") + teacherSection() + teacherCatalogueSection() + merchantProductsSection() + healthProviderSection() + medicalNotesSection();
}

function roadmapView() {
  return renderRoadmapPage({
    items: state.roadmapItems,
    profile: state.profile,
    preview: CONFIG.isPublicPreview,
    error: state.roadmapError,
    audit: state.roadmapAudit,
    savingId: state.roadmapSavingId
  });
}

function authModal() {
  const register = state.authMode === "register";
  return `
    <div class="modal-backdrop" data-action="backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="modal-close" data-action="close-modal" aria-label="إغلاق">×</button>
        <span class="eyebrow">حساب وصلة</span>
        <h2 id="auth-title">${register ? "إنشاء حساب جديد" : "مرحبًا بعودتك"}</h2>
        <p class="modal-subtitle">${register ? "استخدم رقم موبايلك أو بريدك الإلكتروني لإنشاء الحساب." : "ادخل برقم الموبايل أو البريد الإلكتروني وكلمة المرور."}</p>
        <form data-form="auth" novalidate>
          ${register ? `
            <label>الاسم بالكامل<input name="full_name" required minlength="2" maxlength="60" autocomplete="name" placeholder="الاسم بالكامل"></label>
          ` : ""}
          <label>رقم الموبايل أو البريد الإلكتروني
            <input name="identifier" type="text" required autocomplete="username" inputmode="text"
              placeholder="01xxxxxxxxx أو name@gmail.com">
          </label>
          <label>كلمة المرور<input name="password" type="password" required minlength="8" autocomplete="${register ? "new-password" : "current-password"}" placeholder="8 أحرف على الأقل"></label>
          ${register ? `
            <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
            <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
          ` : ""}
          <button class="btn btn-primary btn-block" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ التنفيذ..." : (register ? "إنشاء الحساب" : "تسجيل الدخول")}</button>
        </form>
        ${!register && !CONFIG.isPublicPreview ? '<button class="switch-auth" data-action="forgot-password">استعادة حساب البريد الإلكتروني</button>' : ""}
        ${!CONFIG.isPublicPreview && state.googleAuthEnabled ? '<button class="btn btn-outline btn-block" type="button" data-action="google-auth">المتابعة باستخدام Google</button>' : ""}
        <p class="form-footnote">${state.phoneAuthReady ? "الدخول وإنشاء الحساب برقم الهاتف وكلمة مرور دون SMS. لا يمكن استعادة الحساب عبر الرقم وحده دون وسيلة موثقة." : "يمكنك الدخول برقم الهاتف للحسابات الموجودة دون SMS. تسجيل حساب جديد برقم الهاتف يحتاج إعدادًا إضافيًا؛ استخدم بريدًا إلكترونيًا حقيقيًا للتسجيل."}</p>
        ${CONFIG.isPublicPreview
          ? '<p class="form-footnote preview-auth-note">إنشاء الحسابات متوقف في نسخة المعاينة لحماية قاعدة البيانات الحية.</p>'
          : `<button class="switch-auth" data-action="switch-auth">${register ? "لديك حساب بالفعل؟ تسجيل الدخول" : "ليس لديك حساب؟ إنشاء حساب جديد"}</button>`}
      </section>
    </div>
  `;
}

function passwordResetModal() {
  return `
    <div class="modal-backdrop" data-action="backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <button class="modal-close" data-action="close-modal" aria-label="إغلاق">×</button>
        <span class="eyebrow">استعادة الحساب</span>
        <h2 id="reset-title">نسيت كلمة المرور؟</h2>
        <p class="modal-subtitle">سنرسل رابطًا آمنًا لإعادة تعيين كلمة المرور إلى بريدك الإلكتروني.</p>
        <form data-form="password-reset" novalidate>
          <label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email" placeholder="name@example.com"></label>
          <button class="btn btn-primary btn-block" type="submit">إرسال رابط الاستعادة</button>
        </form>
      </section>
    </div>
  `;
}

function passwordRecoveryModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <span class="eyebrow">تأمين الحساب</span>
        <h2 id="recovery-title">تعيين كلمة مرور جديدة</h2>
        <p class="modal-subtitle">اختر كلمة مرور قوية لا تقل عن 8 أحرف.</p>
        <form data-form="password-recovery" novalidate>
          <label>كلمة المرور الجديدة<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
          <label>تأكيد كلمة المرور<input name="confirm_password" type="password" required minlength="8" autocomplete="new-password"></label>
          <button class="btn btn-primary btn-block" type="submit">حفظ كلمة المرور</button>
        </form>
      </section>
    </div>
  `;
}

function providerInviteModal() {
  return `
    <div class="modal-backdrop" data-action="backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="provider-invite-title">
        <button class="modal-close" data-action="close-modal" aria-label="إغلاق">×</button>
        <span class="eyebrow">الانضمام إلى وصلة</span>
        <h2 id="provider-invite-title">تفعيل حساب مقدم خدمة</h2>
        <p class="modal-subtitle">أدخل كود الدعوة والبيانات المهنية. سيظل الحساب قيد المراجعة حتى اعتماد الإدارة.</p>
        <form data-form="provider-invite" novalidate>
          <label>كود الدعوة<input name="code" required minlength="6" maxlength="32" autocomplete="off" placeholder="كود الدعوة"></label>
          <label>الاسم الذي سيظهر للعملاء<input name="display_name" required minlength="2" maxlength="100" placeholder="الاسم أو اسم النشاط"></label>
          <label>التخصص أو نوع الخدمة<input name="specialty" required minlength="2" maxlength="120" placeholder="سباكة، كهرباء، باطنة..."></label>
          <label>منطقة التغطية<input name="area" required minlength="2" maxlength="120" placeholder="شبين القناطر والمناطق القريبة"></label>
          <button class="btn btn-primary btn-block" type="submit" ${state.providerInviteSaving || CONFIG.isPublicPreview ? "disabled" : ""}>${state.providerInviteSaving ? "جارٍ إرسال الطلب..." : "إرسال طلب الانضمام"}</button>
        </form>
        ${CONFIG.isPublicPreview ? '<p class="form-footnote preview-auth-note">تفعيل الحسابات متوقف في نسخة المعاينة.</p>' : ""}
      </section>
    </div>
  `;
}

function orderModal() {
  const item = state.pendingService;
  if (!item) return "";
  return `
    <div class="modal-backdrop" data-action="backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="order-title">
        <button class="modal-close" data-action="close-modal" aria-label="إغلاق">×</button>
        <span class="eyebrow">${escapeHTML(sectorLabel(item.sector))}</span>
        <h2 id="order-title">طلب خدمة: ${escapeHTML(item.name)}</h2>
        <p class="modal-subtitle">السعر المعروض من قاعدة البيانات: <strong>${escapeHTML(formatEGP(item.price_egp))}</strong></p>
        <form data-form="order" novalidate>
          <button class="btn btn-outline btn-block location-button" type="button" data-action="get-location" ${state.busy ? "disabled" : ""}>📍 استخدم موقعي الحالي</button>
          <p class="location-help">${state.pendingLocation
            ? `تم تحديد موقعك بدقة تقريبية ${Math.round(state.pendingLocation.accuracy)} متر. يمكنك تعديل العنوان.`
            : "يمكنك استخدام GPS لتسجيل موقع تنفيذ الخدمة دون كتابة عنوان تفصيلي."}</p>
          <label>عنوان تنفيذ الخدمة<input name="address" required minlength="4" maxlength="255" autocomplete="street-address" value="${escapeHTML(state.pendingAddress || (state.pendingLocation ? "موقعي الحالي" : ""))}" placeholder="الشارع والمنطقة ورقم العقار"></label>
          <label>ملاحظات إضافية<textarea name="notes" maxlength="500" rows="3" placeholder="تفاصيل تساعد مقدم الخدمة"></textarea></label>
          <div class="consent-panel">
            <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
            <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
          </div>
          <p class="form-footnote">إرسال الطلب طلب مبدئي؛ الإدارة تؤكد توافر الفني والموعد والتكلفة معك قبل التنفيذ. لا يتم تحصيل أي مبالغ داخل وصلة حاليًا.</p>
          ${CONFIG.isPublicPreview ? '<p class="form-footnote preview-auth-note">هذه نسخة معاينة متصلة بقاعدة بيانات حية؛ إرسال الطلبات الفعلية متوقف هنا.</p>' : ""}
          <button class="btn btn-primary btn-block" type="submit" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>${CONFIG.isPublicPreview ? "الإرسال متوقف في المعاينة" : (state.busy ? "جارٍ إرسال الطلب..." : "تأكيد إرسال الطلب")}</button>
        </form>
      </section>
    </div>
  `;
}

function modalView() {
  if (state.modal === "auth") return authModal();
  if (state.modal === "password-reset") return passwordResetModal();
  if (state.modal === "password-recovery") return passwordRecoveryModal();
  if (state.modal === "order") return orderModal();
  if (state.modal === "provider-invite") return providerInviteModal();
  return "";
}

function render() {
  const view = state.view === "orders" ? ordersView()
    : state.view === "operations" ? operationsView()
    : state.view === "crm" ? crmView()
    : state.view === "provider" ? providerView()
    : state.view === "roadmap" ? roadmapView()
    : homeView();

  root.innerHTML = `
    ${header()}
    ${CONFIG.isTestBackend ? `<div class="preview-banner" role="note">بيئة اختبار: بيانات تجريبية فقط، ولا تدخل أي بيانات حقيقية. ${CONFIG.isPublicPreview ? "الكتابة متوقفة من هذا العنوان." : "الدخول بحسابات الاختبار فقط."}</div>` : CONFIG.isPublicPreview ? '<div class="preview-banner" role="note">نسخة معاينة — يمكنك تصفح الخدمات وتسجيل الدخول للقراءة، لكن إنشاء الحسابات والطلبات وحفظ الموافقات متوقف لحماية قاعدة البيانات الحية.</div>' : ""}
    <main class="app-main">${view}</main>
    <footer class="site-footer">
      <div class="footer-brand"><span class="brand-mark small" aria-hidden="true"><span>W</span></span><strong>WASLA <span>وصلة</span></strong></div>
      <p>وصلة مش فاصلة، وصلة شغالة.</p>
      <nav class="footer-policy-links" aria-label="السياسات"><a href="./terms.html">الشروط</a><a href="./privacy.html">الخصوصية</a><a href="./cancellation.html">الإلغاء والاسترداد</a></nav>
      <small>نسخة تشغيل أولية · شبين القناطر · ${new Date().getFullYear()}</small>
    </footer>
    ${modalView()}
  `;
}

async function loadCatalog() {
  state.loadError = "";

  const [servicesResult, offersResult] = await Promise.allSettled([
    dataApi.getServices(),
    dataApi.getOffers()
  ]);

  if (servicesResult.status === "fulfilled") {
    state.services = Array.isArray(servicesResult.value) ? servicesResult.value : [];
  } else {
    state.services = [];
    state.loadError = servicesResult.reason?.message || "تعذر تحميل الخدمات.";
  }

  if (offersResult.status === "fulfilled") {
    state.offers = Array.isArray(offersResult.value) ? offersResult.value : [];
  } else {
    // Offers are supplemental; an offers failure must not hide the service catalogue.
    state.offers = [];
  }
  state.catalogLoaded = true;
}

async function loadRoadmap() {
  state.roadmapLoaded = false;
  state.roadmapError = "";
  try {
    const rows = await dataApi.getRoadmap();
    state.roadmapItems = Array.isArray(rows) ? rows : [];
  } catch (error) {
    state.roadmapItems = [];
    state.roadmapError = error.message || "تعذر تحميل خطة الإنجاز.";
  } finally {
    state.roadmapLoaded = true;
  }
}

async function loadRoadmapAudit() {
  if (state.profile?.role !== "admin" || CONFIG.isPublicPreview) {
    state.roadmapAudit = [];
    return;
  }
  try {
    state.roadmapAudit = await dataApi.getRoadmapAudit(10);
  } catch (error) {
    state.roadmapAudit = [];
    showToast(error.message || "تعذر تحميل سجل تغييرات الخطة.", "error");
  }
}

async function refreshRoadmap() {
  await loadRoadmap();
  await loadRoadmapAudit();
  state.view = "roadmap";
  render();
}

async function submitRoadmapMilestone(form) {
  if (state.profile?.role !== "admin") {
    throw new Error("تعديل خطة الإنجاز متاح لحساب المؤسس فقط.");
  }
  if (CONFIG.isPublicPreview) {
    throw new Error("تعديل الخطة متوقف في نسخة المعاينة.");
  }

  const id = String(form.dataset.milestoneId || "");
  const values = Object.fromEntries(new FormData(form).entries());
  const validation = validateRoadmapUpdate(
    values.status,
    Number(values.progress_percent),
    values.test_status
  );
  if (!validation.valid) throw new Error(validation.message);

  state.roadmapSavingId = id;
  render();
  try {
    await dataApi.updateRoadmapMilestone(id, {
      status: values.status,
      progressPercent: Number(values.progress_percent),
      testStatus: values.test_status
    });
    await loadRoadmap();
    await loadRoadmapAudit();
    showToast("تم تحديث البند وإعادة حساب نسبة الإنجاز.", "success");
  } finally {
    state.roadmapSavingId = "";
    render();
  }
}

async function loadAccount() {
  try {
    state.session = await authApi.getSession();
    if (!state.session) return;
    state.user = await authApi.getUser();
    if (!state.user?.id) return;
    state.profile = await dataApi.getProfile(state.user.id);
    try {
      await dataApi.completePendingConsent(state.user);
    } catch (error) {
      showToast("تم تسجيل الدخول، لكن تعذر مزامنة موافقات السياسات. ستُعاد المحاولة لاحقًا.", "error");
    }
  } catch (error) {
    state.user = null;
    state.profile = null;
    state.session = null;
    if (String(error.message).includes("الاتصال")) showToast(error.message, "error");
  }
}

function openAuth(mode = "login") {
  state.authMode = mode;
  state.modal = "auth";
  render();
  root.querySelector('input[name="identifier"]')?.focus();
}

function openOrder(item) {
  if (state.user && state.profile?.role !== "customer") {
    showToast("إرسال الطلبات متاح لحسابات العملاء فقط.", "error");
    return;
  }
  state.pendingOrderIdempotencyKey = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `wsl-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  state.pendingLocation = null;
  state.pendingAddress = "";
  state.pendingService = item;
  localStorage.setItem(PENDING_ORDER_SERVICE_KEY, String(item.id));
  if (!state.user) {
    openAuth("register");
    return;
  }
  state.pendingService = item;
  state.pendingLocation = null;
  state.pendingAddress = "";
  state.modal = "order";
  render();
  root.querySelector('input[name="address"]')?.focus();
}

async function refreshMyOrders() {
  if (!state.user?.id) {
    openAuth("login");
    return;
  }
  if (state.profile?.role !== "customer") {
    showToast("سجل الطلبات متاح لحسابات العملاء فقط.", "error");
    return;
  }
  try {
    state.myOrders = await dataApi.getMyOrders(state.user.id);
    state.changeRequests = await dataApi.getMyChangeRequests();
    state.notifications = await dataApi.getMyNotifications();
    try { state.deliveries = await dataApi.getMyDeliveries(); } catch { state.deliveries = null; }
    try { state.doctors = await dataApi.getDoctors(); } catch { state.doctors = null; }
    try { state.products = await dataApi.getProducts(); } catch { state.products = null; }
    try { state.sessions = await dataApi.getSessions(); state.enrollments = await dataApi.getMyEnrollments(); await loadSessionLinks(); } catch { state.sessions = null; state.enrollments = null; }
    await loadMedicalNotes();
    await loadCourses();
    try { state.nursingItems = await dataApi.getNursingItems(); } catch { state.nursingItems = null; }
    try { state.labTests = await dataApi.getLabTests(); state.prescriptions = await dataApi.getMyPrescriptions(); state.pharmacies = state.prescriptions ? await dataApi.getPharmacies() : null; const leftover = await dataApi.retryPendingFileCleanups(); if (leftover) showToast("ملف مرفوع من طلب فاشل لم يُحذف بعد. سنعيد المحاولة عند فتح التطبيق.", "error"); } catch { state.labTests = null; state.prescriptions = null; state.pharmacies = null; }
    if (!state.clinicDay) state.clinicDay = cairoDay(1);
    state.view = "orders";
  } catch (error) {
    showToast(error.message, "error");
  }
  render();
}

async function refreshOperations() {
  if (!["staff", "admin"].includes(state.profile?.role)) {
    showToast("هذه الصفحة غير متاحة لهذا الحساب.", "error");
    return;
  }
  try {
    const [orders, providers, services, coverage] = await Promise.all([
      dataApi.getOperationsOrders(),
      dataApi.getOperationsProviders(),
      state.profile?.role === "admin" ? dataApi.getOperationsServices() : Promise.resolve([]),
      state.profile?.role === "admin" ? dataApi.getOperationsCoverage() : Promise.resolve([])
    ]);
    state.operationsOrders = Array.isArray(orders) ? orders : [];
    state.operationsProviders = Array.isArray(providers) ? providers : [];
    state.operationsServices = Array.isArray(services) ? services : [];
    state.operationsCoverage = Array.isArray(coverage) ? coverage : [];
    try { state.deliveryQueue = await dataApi.getDeliveryQueue(); } catch { state.deliveryQueue = null; }
    state.opsChangeRequests = await dataApi.getMyChangeRequests();
    state.view = "operations";
  } catch (error) {
    showToast(error.message, "error");
  }
  render();
}


async function refreshProvider() {
  const providerRoles = ["doctor", "technician", "teacher", "courier", "merchant"];
  if (!providerRoles.includes(state.profile?.role)) {
    showToast("هذه المساحة مخصصة لمقدمي الخدمة فقط.", "error");
    return;
  }
  state.providerError = "";
  try {
    const result = await dataApi.getProviderWorkspace();
    state.providerRecord = result.provider || null;
    state.providerOrders = Array.isArray(result.orders) ? result.orders : [];
    state.deliveryQueue = null;
    if (state.profile?.role === "courier") {
      try { state.deliveryQueue = await dataApi.getDeliveryQueue(); } catch { state.deliveryQueue = null; }
    }
    await loadHealthWork();
    state.teacherSessions = null;
    if (state.profile?.role === "teacher" && state.providerRecord?.id) {
      try { state.teacherSessions = await dataApi.getSessions(state.providerRecord.id); await loadSessionLinks(); } catch { state.teacherSessions = null; }
    }
    state.view = "provider";
  } catch (error) {
    state.providerRecord = null;
    state.providerOrders = [];
    state.providerError = error.message || "تعذر تحميل طلبات مقدم الخدمة.";
    state.view = "provider";
  }
  render();
}

async function refreshCrm() {
  if (!["staff", "admin"].includes(state.profile?.role)) {
    showToast("وحدة CRM متاحة لفريق التشغيل والإدارة فقط.", "error");
    return;
  }
  state.crmError = "";
  try {
    const [metrics, customers, leads, tasks, tickets, providers] = await Promise.all([
      dataApi.getCrmMetrics(),
      dataApi.getCrmCustomers(),
      dataApi.getCrmLeads(),
      dataApi.getCrmTasks(),
      dataApi.getCrmTickets(),
      dataApi.getOperationsProviders()
    ]);
    state.crmMetrics = metrics || {};
    state.crmCustomers = Array.isArray(customers) ? customers : [];
    state.crmLeads = Array.isArray(leads) ? leads : [];
    state.crmTasks = Array.isArray(tasks) ? tasks : [];
    state.crmTickets = Array.isArray(tickets) ? tickets : [];
    state.crmProviders = Array.isArray(providers) ? providers : [];
    if (state.crmSelectedCustomerId) {
      state.crmCustomer360 = await dataApi.getCrmCustomer360(state.crmSelectedCustomerId);
    }
    state.view = "crm";
  } catch (error) {
    state.crmError = error.message || "تعذر تحميل بيانات CRM.";
  }
  render();
}

async function openCrmCustomer(customerId) {
  if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح.");
  state.crmSelectedCustomerId = customerId;
  state.crmCustomer360 = await dataApi.getCrmCustomer360(customerId);
  state.view = "crm";
  render();
}

async function afterLogin() {
  state.session = await authApi.getSession();
  state.user = await authApi.getUser();
  state.profile = await dataApi.getProfile(state.user.id);
  try {
    await dataApi.completePendingConsent(state.user);
  } catch (error) {
    showToast("تم تسجيل الدخول، لكن تعذر مزامنة موافقات السياسات. ستُعاد المحاولة لاحقًا.", "error");
  }
  if (state.profile?.role === "admin") await loadRoadmapAudit();

  state.modal = null;
  if (state.pendingService && state.profile?.role === "customer") {
    state.modal = "order";
    render();
  } else if (state.pendingService) {
    localStorage.removeItem(PENDING_ORDER_SERVICE_KEY);
    state.pendingService = null;
    state.pendingLocation = null;
    state.pendingAddress = "";
    state.pendingOrderIdempotencyKey = "";
    showToast("تم تسجيل الدخول، لكن إرسال الطلبات متاح لحسابات العملاء فقط.", "error");
    if (["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role)) {
      await refreshProvider();
    } else {
      state.view = "home";
      render();
    }
  } else if (["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role)) {
    await refreshProvider();
  } else {
    state.view = "home";
    render();
  }
}

async function submitAuth(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const identifier = String(values.identifier ?? "").trim();
  const password = String(values.password ?? "");
  const register = state.authMode === "register";

  if (!identifier || !password) throw new Error("أدخل رقم الموبايل أو البريد الإلكتروني وكلمة المرور.");
  const resolvedIdentifier = resolveAuthIdentifier(identifier);
  if (!resolvedIdentifier) throw new Error("أدخل رقم موبايل مصري صحيحًا أو بريدًا إلكترونيًا صحيحًا.");
  if (register && resolvedIdentifier.type === "phone" && !state.phoneAuthReady) {
    throw new Error("الدخول برقم الهاتف متاح للحسابات الموجودة دون SMS. إنشاء حساب جديد برقم الهاتف متوقف حتى تفعيل التأكيد التلقائي للبريد في Supabase؛ استخدم بريدًا إلكترونيًا حقيقيًا للتسجيل حاليًا.");
  }

  let fullName = "";
  if (register) {
    fullName = String(values.full_name ?? "").trim();
    if (fullName.length < 2 || fullName.length > 60) {
      throw new Error("اكتب الاسم من حرفين إلى 60 حرفًا.");
    }
    if (values.terms !== "on" || values.privacy !== "on") {
      throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
    }
  }

  await runWithBusyState(state, async () => {
    render();

    if (!register) {
      await authApi.signIn(identifier, password);
      await afterLogin();
      showToast("تم تسجيل الدخول.", "success");
      return;
    }

    dataApi.markConsentPending();
    const result = await authApi.signUp({ identifier, password, fullName });

    if (result?.access_token) {
      await afterLogin();
      showToast("تم إنشاء الحساب وتسجيل الموافقات.", "success");
    } else {
      state.modal = null;
      render();
      const phoneSignup = result?.identifier_type === "phone";
      showToast(
        phoneSignup
          ? "تم إنشاء الحساب، لكن Supabase ما زال يطلب تأكيد الموبايل. يجب إيقاف Confirm Phone حتى يعمل الدخول دون SMS."
          : "تم إنشاء الحساب. افتح رسالة تأكيد البريد؛ اختيار الخدمة محفوظ على هذا الجهاز، وبعد التأكيد ستكمل طلبك.",
        phoneSignup ? "error" : "success"
      );
    }
  });
}

async function captureDeviceLocation() {
  if (!navigator.geolocation) {
    throw new Error("المتصفح لا يدعم تحديد الموقع.");
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        const messages = {
          1: "لم تسمح بالوصول إلى الموقع. يمكنك كتابة العنوان يدويًا.",
          2: "تعذر تحديد موقعك الحالي. حاول مرة أخرى أو اكتب العنوان.",
          3: "انتهت مهلة تحديد الموقع. حاول مرة أخرى."
        };
        reject(new Error(messages[error.code] || "تعذر تحديد الموقع."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 }
    );
  });

  const { latitude, longitude, accuracy } = position.coords;
  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error("إحداثيات الموقع التي أرجعها الجهاز غير صالحة.");
  }

  state.pendingLocation = {
    lat: latitude,
    lng: longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : 0
  };
  if (!state.pendingAddress.trim()) state.pendingAddress = "موقعي الحالي";
  render();
  showToast("تم تحديد موقعك. راجع العنوان قبل إرسال الطلب.", "success");
}

async function submitOrder(form) {
  if (CONFIG.isPublicPreview) {
    throw new Error("إرسال الطلبات الفعلية متوقف في نسخة المعاينة؛ يمكنك تصفح الخدمات واختبار خطوات النموذج فقط.");
  }
  const values = Object.fromEntries(new FormData(form).entries());
  state.pendingAddress = String(values.address ?? "");
  if (!state.pendingService) throw new Error("اختر الخدمة من جديد.");
  if (!isValidAddress(values.address)) {
    throw new Error("أدخل عنوانًا واضحًا لا يقل عن 4 أحرف.");
  }
  if (String(values.notes ?? "").length > 500) {
    throw new Error("الملاحظات يجب ألا تتجاوز 500 حرف.");
  }
  if (values.terms !== "on" || values.privacy !== "on") {
    throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
  }

  await runWithBusyState(state, async () => {
    render();

    await dataApi.acceptRequiredConsents();
    const result = await dataApi.createServiceOrder(state.pendingService, {
      address: values.address,
      notes: values.notes,
      location: state.pendingLocation,
      idempotencyKey: state.pendingOrderIdempotencyKey
    });
    const record = Array.isArray(result) ? result[0] : result;
    state.pendingOrderIdempotencyKey = "";

    state.modal = null;
    localStorage.removeItem(PENDING_ORDER_SERVICE_KEY);
    state.pendingService = null;
    state.pendingLocation = null;
    state.pendingAddress = "";
    state.pendingOrderIdempotencyKey = "";
    let ordersReloaded = true;
    try {
      state.myOrders = await dataApi.getMyOrders(state.user.id);
    } catch {
      ordersReloaded = false;
      state.myOrders = [];
      state.nursingTimeRetry = null;
      state.trackingOrderId = "";
      state.trackingLoadingId = "";
      state.orderTracking = null;
    }

    state.view = "orders";
    render();

    const ref = record?.out_ref ? `رقم ${record.out_ref}` : "طلبك";
    showToast(
      ordersReloaded
        ? `تم استلام ${ref}`
        : `تم استلام ${ref}، لكن تعذر تحديث قائمة الطلبات. افتح طلباتي واضغط تحديث.`,
      ordersReloaded ? "success" : "error"
    );
  });
}

root.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "backdrop" && event.target !== button) return;

  try {
    if (action === "auth") openAuth("login");
    else if (action === "get-location") {
      const currentAddress = root.querySelector('input[name="address"]')?.value ?? state.pendingAddress;
      state.pendingAddress = currentAddress;
      await captureDeviceLocation();
    }
    else if (action === "close-modal" || action === "backdrop") {
      state.modal = null;
      if (state.pendingService) {
        localStorage.removeItem(PENDING_ORDER_SERVICE_KEY);
        state.pendingService = null;
        state.pendingLocation = null;
        state.pendingAddress = "";
        state.pendingOrderIdempotencyKey = "";
      }
      render();
    } else if (action === "switch-auth") {
      state.authMode = state.authMode === "login" ? "register" : "login";
      render();
    } else if (action === "google-auth") {
      if (CONFIG.isPublicPreview) throw new Error("تسجيل Google متوقف في نسخة المعاينة.");
      await authApi.signInWithGoogle();
    } else if (action === "forgot-password") {
      state.modal = "password-reset";
      render();
      root.querySelector('input[name="email"]')?.focus();
    } else if (action === "logout") {
      await authApi.signOut();
      state.user = state.profile = state.session = null;
      state.myOrders = [];
      state.nursingTimeRetry = null;
      state.trackingOrderId = "";
      state.trackingLoadingId = "";
      state.orderTracking = null;
      state.operationsOrders = [];
      state.operationsProviders = [];
      state.operationsServices = [];
      state.operationsCoverage = [];
      state.latestInviteCode = "";
      state.roadmapAudit = [];
      state.view = "home";
      render();
      showToast("تم تسجيل الخروج.", "success");
    } else if (action === "roadmap" || action === "reload-roadmap") {
      await refreshRoadmap();
    } else if (action === "orders" || action === "reload-orders") {
      await refreshMyOrders();
    } else if (action === "open-notification-order") {
      const card = document.getElementById(`order-${button.dataset.orderId}`);
      if (!card) throw new Error("الطلب مش ظاهر في القائمة.");
      card.style.scrollMarginTop = "110px";
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("notification-target");
      setTimeout(() => card.classList.remove("notification-target"), 2500);
    } else if (action === "open-notification-target") {
      const card = document.getElementById(`${button.dataset.targetType}-${button.dataset.targetId}`);
      if (!card) throw new Error(button.dataset.kind === "session_cancelled" ? "الحصة دي اتلغت ومش ظاهرة في تسجيلاتك." : "العنصر ده مش متاح دلوقتي (اتلغى أو اتقفل).");
      card.style.scrollMarginTop = "110px";
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("notification-target");
      setTimeout(() => card.classList.remove("notification-target"), 2500);
    } else if (action === "mark-notifications-read") {
      await dataApi.markNotificationsRead();
      state.notifications = await dataApi.getMyNotifications();
      render();
    } else if (action === "track-order") {
      if (!state.user?.id) throw new Error("سجل الدخول لمتابعة الطلب.");
      const orderId = button.dataset.orderId;
      if (!orderId) throw new Error("الطلب غير محدد.");
      if (state.trackingOrderId === orderId) {
        state.trackingOrderId = "";
        state.orderTracking = null;

        render();
        return;
      }
      state.trackingOrderId = orderId;
      state.trackingLoadingId = orderId;
      state.orderTracking = null;
      render();
      try {
        state.orderTracking = await dataApi.getMyOrderTracking(orderId);
      } finally {
        state.trackingLoadingId = "";
        render();
      }
    } else if (action === "respond-quote") {
      if (!state.user?.id) throw new Error("سجل الدخول للرد على عرض السعر.");
      if (CONFIG.isPublicPreview) throw new Error("الرد على عروض الأسعار متوقف في نسخة المعاينة.");
      const accept = button.dataset.decision === "accept";
      const orderId = button.dataset.orderId;
      if (!window.confirm(accept ? "هل توافق على السعر المعروض؟ سيتم تأكيد الطلب بهذا السعر." : "هل ترفض السعر؟ سيتم إلغاء الطلب.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.respondToQuote(orderId, button.dataset.version, accept);
        state.myOrders = await dataApi.getMyOrders(state.user.id);
        state.view = "orders";
        showToast(accept ? "تمت الموافقة وتأكيد الطلب." : "تم رفض السعر وإلغاء الطلب.", "success");
      });
      render();
    } else if (action === "enroll-session") {
      if (state.profile?.role !== "customer") throw new Error("التسجيل متاح لحسابات العملاء فقط.");
      if (!window.confirm("تأكيد التسجيل في الحصة؟ بالتسجيل توافق على الشروط وسياسة الخصوصية.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.enrollInSession(button.dataset.sessionId);
        state.sessions = await dataApi.getSessions();
        state.enrollments = await dataApi.getMyEnrollments();
        await loadSessionLinks();
        showToast("تم تسجيلك في الحصة.", "success");
      });
      render();
    } else if (action === "enroll-course") {
      if (state.profile?.role !== "customer") throw new Error("التسجيل متاح لحسابات العملاء فقط.");
      if (!window.confirm("تأكيد التسجيل في الدورة؟ بالتسجيل توافق على الشروط وسياسة الخصوصية. الدفع للمدرس مباشرة.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.enrollInCourse(button.dataset.courseId);
        await loadCourses();
        showToast("تم تسجيلك في الدورة.", "success");
      });
      render();
    } else if (action === "cancel-course-enrollment") {
      if (!window.confirm("إلغاء التسجيل في الدورة؟")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.cancelCourseEnrollment(button.dataset.enrollmentId);
        await loadCourses();
        showToast("تم إلغاء التسجيل.", "success");
      });
      render();
    } else if (action === "toggle-course") {
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherSetCourseActive(button.dataset.courseId, button.dataset.active === "yes");
        await loadCourses();
        showToast("تم التحديث.", "success");
      });
      render();
    } else if (action === "toggle-product") {
      await runWithBusyState(state, async () => {
        render();
        await dataApi.updateProduct(button.dataset.productId, { active: button.dataset.active === "yes" });
        await loadHealthWork();
        showToast("تم التحديث.", "success");
      });
      render();
    } else if (action === "toggle-lab-test") {
      await runWithBusyState(state, async () => {
        render();
        await dataApi.setLabTestActive(button.dataset.testId, button.dataset.active === "yes");
        await loadHealthWork();
        showToast("تم التحديث.", "success");
      });
      render();
    } else if (action === "open-rx-file") {
      const url = await dataApi.getPrescriptionFileUrl(button.dataset.path);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else if (action === "close-prescription") {
      if (!window.confirm("إغلاق الطلب؟ لن تتمكن أي صيدلية من رؤيته بعد ذلك.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.closePrescription(button.dataset.requestId);
        state.prescriptions = await dataApi.getMyPrescriptions();
        showToast("تم إغلاق الطلب وسحب المشاركة.", "success");
      });
      render();
    } else if (action === "cancel-enrollment") {
      if (state.profile?.role !== "customer") throw new Error("هذه العملية للعملاء فقط.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.cancelEnrollment(button.dataset.enrollmentId);
        state.enrollments = await dataApi.getMyEnrollments();
        await loadSessionLinks();
        showToast("تم إلغاء التسجيل.", "success");
      });
      render();
    } else if (action === "teacher-cancel-session") {
      if (state.profile?.role !== "teacher") throw new Error("هذه العملية للمدرس فقط.");
      if (!window.confirm("إلغاء الحصة سيلغي تسجيل كل الطلاب. متابعة؟")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherCancelSession(button.dataset.sessionId);
        state.teacherSessions = await dataApi.getSessions(state.providerRecord.id);
        showToast("تم إلغاء الحصة.", "success");
      });
      render();
    } else if (action === "courier-delivery") {
      if (state.profile?.role !== "courier") throw new Error("هذه العملية للمندوب فقط.");
      const to = button.dataset.to;
      if (!["picked_up", "delivered"].includes(to)) throw new Error("الحالة غير مسموحة.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.courierSetDeliveryStatus(button.dataset.requestId, to);
        state.deliveryQueue = await dataApi.getDeliveryQueue();
        showToast("تم تحديث حالة التوصيل.", "success");
      });
      render();
    } else if (action === "customer-cancel-delivery") {
      if (!state.user?.id) throw new Error("سجل الدخول لإلغاء الطلب.");
      if (!window.confirm("هل تريد إلغاء طلب التوصيل؟ يمكن الإلغاء قبل التعيين فقط.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.cancelDelivery(button.dataset.requestId);
        state.deliveries = await dataApi.getMyDeliveries();
        showToast("تم إلغاء طلب التوصيل.", "success");
      });
      render();
    } else if (action === "nursing-time-skip") {
      state.nursingTimeRetry = null;
      render();
    } else if (action === "customer-cancel-order") {
      if (!state.user?.id) throw new Error("سجل الدخول لإلغاء الطلب.");
      if (CONFIG.isPublicPreview) throw new Error("إلغاء الطلبات متوقف في نسخة المعاينة.");
      const orderId = button.dataset.orderId;
      if (!orderId) throw new Error("الطلب غير محدد.");
      if (!window.confirm("هل تريد إلغاء الطلب؟ يمكن الإلغاء قبل تأكيده فقط.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.customerCancelOrder(orderId, "إلغاء بطلب العميل من صفحة طلباتي");
        if (state.trackingOrderId === orderId) {
          state.trackingOrderId = "";
          state.orderTracking = null;
        }
        let refreshed = true;
        try {
          state.myOrders = await dataApi.getMyOrders(state.user.id);
        } catch {
          refreshed = false;
        }
        state.view = "orders";
        showToast(
          refreshed
            ? "تم إلغاء الطلب قبل تأكيده."
            : "تم الإلغاء، لكن تعذر تحديث القائمة. اضغط تحديث لعرض الحالة الجديدة.",
          refreshed ? "success" : "error"
        );
      });
      render();
    } else if (action === "operations" || action === "reload-operations") {
      await refreshOperations();
    } else if (action === "crm" || action === "reload-crm") {
      await refreshCrm();
    } else if (action === "provider" || action === "reload-provider") {
      await refreshProvider();
    } else if (action === "crm-customer") {
      await openCrmCustomer(button.dataset.customerId);
    } else if (action === "crm-back-customers") {
      state.crmSelectedCustomerId = "";
      state.crmCustomer360 = null;
      render();
    } else if (action === "crm-task-done") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      state.crmSaving = true;
      render();
      try {
        await dataApi.completeCrmTask(button.dataset.taskId);
        await refreshCrm();
        showToast("تم إغلاق المهمة.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    } else if (action === "ops-resolve-change") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح.");
      state.operationsSaving = true;
      render();
      try {
        await dataApi.resolveOrderChange({ requestId: button.dataset.requestId, status: button.dataset.status });
        showToast(button.dataset.status === "applied" ? "تم تسجيل التنفيذ." : "تم تسجيل المراجعة بدون تغيير.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    } else if (action === "ops-set-status") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بتغيير حالة الطلب.");
      const orderId = button.dataset.orderId;
      const nextStatus = button.dataset.status;
      const labels = { confirmed:"تأكيد الطلب", in_progress:"بدء التنفيذ", done:"إنهاء الطلب", cancelled:"إلغاء الطلب" };
      if (!window.confirm(`هل تريد ${labels[nextStatus] || "تغيير الحالة"}؟`)) return;
      state.operationsSaving = true;
      render();
      try {
        await dataApi.updateOrderStatus(orderId, nextStatus, "تم التحديث من لوحة التشغيل");
        showToast("تم تحديث حالة الطلب.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    } else if (action === "provider-set-status") {
      if (CONFIG.isPublicPreview) throw new Error("تحديث الحالات متوقف في نسخة المعاينة.");
      if (!["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role)) throw new Error("غير مصرح بتحديث الطلب.");
      const orderId = button.dataset.orderId;
      const nextStatus = button.dataset.status;
      const label = nextStatus === "done" ? "تأكيد إتمام الخدمة" : nextStatus === "confirmed" ? "تأكيد الموعد" : "بدء التنفيذ";
      if (!window.confirm("هل تريد " + label + "؟")) return;
      state.providerSaving = true;
      render();
      try {
        if (button.dataset.kind === "clinic") {
          await dataApi.doctorSetAppointmentStatus(orderId, nextStatus, "تم تحديث الموعد من مساحة الطبيب");
        } else {
          await dataApi.providerSetOrderStatus(orderId, nextStatus, "تم تحديث الحالة من مساحة مقدم الخدمة");
        }
        showToast("تم تحديث حالة الطلب.", "success");
        await refreshProvider();
      } finally {
        state.providerSaving = false;
        render();
      }
    } else if (action === "approve-provider") {
      if (CONFIG.isPublicPreview) throw new Error("الاعتماد متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح باعتماد مقدم الخدمة.");
      if (!window.confirm("هل راجعت بيانات مقدم الخدمة وتريد اعتماده؟")) return;
      state.operationsSaving = true;
      render();
      try {
        await dataApi.approveProvider(button.dataset.providerId);
        showToast("تم اعتماد مقدم الخدمة.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    } else if (action === "provider-invite") {
      if (!state.user || state.profile?.role !== "customer") throw new Error("تسجيل الانضمام متاح لحسابات العملاء فقط.");
      state.modal = "provider-invite";
      render();
    } else if (action === "set-nursing-credential") {
      if (CONFIG.isPublicPreview) throw new Error("الاعتماد متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح باعتماد التمريض.");
      const grant = button.dataset.verified === "yes";
      if (!window.confirm(grant ? "هل راجعت ترخيص مقدم الخدمة للتمريض وتريد اعتماده؟" : "سحب اعتماد التمريض؟")) return;
      await dataApi.setNursingCredential(button.dataset.providerId, grant);
      await refreshOperations();
      showToast(grant ? "تم اعتماد مقدم الخدمة للتمريض." : "تم سحب اعتماد التمريض.", "success");
    } else if (action === "disable-provider-coverage") {
      if (CONFIG.isPublicPreview) throw new Error("إدارة التغطية متوقفة في نسخة المعاينة.");
      if (state.profile?.role !== "admin") throw new Error("إدارة التغطية مخصصة للمؤسس فقط.");
      await dataApi.adminSetProviderServiceCoverage(
        button.dataset.providerId,
        button.dataset.serviceId,
        false
      );
      await Promise.all([refreshOperations(), loadCatalog()]);
      showToast("تم إيقاف التغطية. ستتوقف الخدمة عن استقبال الطلبات إذا لم يوجد بديل.", "success");
    } else if (action === "copy-invite") {
      if (!state.latestInviteCode) throw new Error("لا يوجد كود دعوة لنسخه.");
      await navigator.clipboard.writeText(state.latestInviteCode);
      showToast("تم نسخ كود الدعوة.", "success");
    } else if (action === "home") {
      state.view = "home";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (action === "request-service") {
      const item = state.services.find((service) => Number(service.id) === Number(button.dataset.itemId));
      if (item && canRequestService(item)) openOrder(item);
    } else if (action === "clinic-info") {
      showToast("حجز العيادات سيتاح بعد اعتماد جداول العمل الحقيقية.", "info");
    } else if (action === "coming-soon") {
      showToast("هذا القطاع لم يكتمل تشغيله بعد.", "info");
    } else if (action === "sector") {
      const sector = SECTORS.find((entry) => entry.code === button.dataset.sector);
      if (sector?.mode === "soon") {
        showToast("هذا القطاع قيد التجهيز وسيظهر عند توفر مقدمي خدمة فعليين.", "info");
      } else {
        document.querySelector("#services")?.scrollIntoView({ behavior: "smooth" });
      }
    } else if (action === "reload") {
      await loadCatalog();
      render();
    } else if (action === "account") {
      showToast(`الدور الحالي: ${state.profile?.role || "غير معروف"}`, "info");
    }
  } catch (error) {
    render();
    showToast(error.message || "حدث خطأ غير متوقع.", "error");
  }
});

root.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();

  try {
    if (form.dataset.form === "auth") { await submitAuth(form); render(); }
    if (form.dataset.form === "delivery-request") {
      if (CONFIG.isPublicPreview) throw new Error("طلبات التوصيل متوقفة في نسخة المعاينة.");
      if (state.profile?.role !== "customer") throw new Error("طلب التوصيل متاح لحسابات العملاء فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (values.terms !== "on" || values.privacy !== "on") throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.placeDeliveryRequest(values.pickup, values.dropoff, values.what);
        state.deliveries = await dataApi.getMyDeliveries();
        showToast("تم استلام طلب التوصيل.", "success");
      });
      render();
    }
    if (form.dataset.form === "clinic-book") {
      if (CONFIG.isPublicPreview) throw new Error("الحجز متوقف في نسخة المعاينة.");
      if (state.profile?.role !== "customer") throw new Error("الحجز متاح لحسابات العملاء فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.doctor || !values.slot) throw new Error("اختر الطبيب والموعد.");
      if (values.terms !== "on" || values.privacy !== "on") throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.bookClinicSlot(values.doctor, values.slot, values.notes);
        state.myOrders = await dataApi.getMyOrders(state.user.id);
        await loadClinicSlots();
        showToast("تم حجز الموعد. بانتظار تأكيد الطبيب.", "success");
      });
      render();
    }
    if (form.dataset.form === "teacher-profile") {
      if (CONFIG.isPublicPreview) throw new Error("الحفظ متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherSaveProfile({ headline: data.get("headline"), bio: data.get("bio"), subjects: data.get("subjects") });
        await loadCourses();
        showToast("تم حفظ الملف.", "success");
      });
      render();
    }
    if (form.dataset.form === "teacher-course") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherCreateCourse({ title: data.get("title"), subject: data.get("subject"), description: data.get("description"), lessons: data.get("lessons"), mode: data.get("mode"), price: data.get("price"), seats: data.get("seats") });
        await loadCourses();
        showToast("تمت إضافة الدورة.", "success");
      });
      render();
    }
    if (form.dataset.form === "doctor-note") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.doctorAddNote({ orderId: data.get("order"), note: data.get("note") });
        await loadMedicalNotes();
        showToast("تم حفظ الملاحظة.", "success");
      });
      render();
    }
    if (form.dataset.form === "pharmacy-quote") {
      if (CONFIG.isPublicPreview) throw new Error("الإرسال متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.pharmacyQuote({ requestId: form.dataset.requestId, price: data.get("price"), note: data.get("note"), delivery: data.get("delivery") === "yes", eta: data.get("eta") });
        await loadHealthWork();
        showToast("تم إرسال ردك للعميل.", "success");
      });
      render();
    }
    if (form.dataset.form === "product-add") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.saveProduct({ name: data.get("name"), category: data.get("category"), price: data.get("price"), stock: data.get("stock") });
        await loadHealthWork();
        showToast("تمت إضافة المنتج.", "success");
      });
      render();
    }
    if (form.dataset.form === "product-edit") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.updateProduct(form.dataset.productId, { name: data.get("name"), price: data.get("price"), category: data.get("category") });
        await loadHealthWork();
        showToast("تم حفظ بيانات المنتج.", "success");
      });
      render();
    }
    if (form.dataset.form === "order-change-request") {
      if (CONFIG.isPublicPreview) throw new Error("الطلب متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.requestOrderChange({ orderId: form.dataset.orderId, kind: data.get("kind"), note: data.get("note") });
        state.changeRequests = await dataApi.getMyChangeRequests();
        showToast("تم إرسال طلبك. فريق وصلة هيراجعه ويتواصل معاك. الطلب لسه زي ما هو.", "success");
      });
      render();
    }
    if (form.dataset.form === "nursing-time-retry") {
      if (CONFIG.isPublicPreview) throw new Error("الطلب متوقف في نسخة المعاينة.");
      const pending = state.nursingTimeRetry;
      if (!pending) return;
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.setNursingPreferredTime({ orderId: pending.orderId, value: data.get("preferred_at") });
        state.nursingTimeRetry = null;
        state.myOrders = await dataApi.getMyOrders(state.user?.id);
        showToast("تم حفظ الموعد المقترح. هيتأكد من فريق وصلة.", "success");
      });
      render();
    }
    if (form.dataset.form === "nursing-request") {
      if (CONFIG.isPublicPreview) throw new Error("الطلب متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        const sent = await dataApi.requestNursingVisit({ itemId: data.get("item"), address: data.get("address"), notes: data.get("notes"), consent: data.get("consent") === "yes", terms: data.get("terms") === "yes", preferredAt: data.get("preferred_at") || null });
        state.myOrders = await dataApi.getMyOrders(state.user?.id);
        if (sent && sent.preferredTimeSaved === false) {
          state.nursingTimeRetry = { orderId: sent.out_order_id, ref: sent.out_ref };
          showToast("تم إرسال طلب التمريض لكن الموعد المقترح ما اتحفظش. متبعتش الطلب تاني، فريق وصلة هيتواصل معاك لتحديد الموعد.", "error");
        } else {
          showToast("تم إرسال طلب التمريض. هيتم تعيين ممرض معتمد وتأكيد الموعد معاك.", "success");
        }
      });
      render();
    }
    if (form.dataset.form === "product-stock") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.updateProduct(form.dataset.productId, { stock: data.get("stock") });
        await loadHealthWork();
        showToast("تم حفظ المخزون.", "success");
      });
      render();
    }
    if (form.dataset.form === "lab-test") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const data = new FormData(form);
      await runWithBusyState(state, async () => {
        render();
        await dataApi.upsertLabTest({ kind: form.dataset.kind, name: data.get("name"), price: data.get("price") });
        await loadHealthWork();
        showToast("تم حفظ السعر.", "success");
      });
      render();
    }
    if (form.dataset.form === "prescription") {
      if (CONFIG.isPublicPreview) throw new Error("الإرسال متوقف في نسخة المعاينة.");
      const data = new FormData(form);
      const values = { note: data.get("note"), file: data.get("file"), pharmacies: data.getAll("pharmacy"), consent: data.get("consent") === "yes" };
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.submitPrescription(values);
        state.prescriptions = await dataApi.getMyPrescriptions();
        showToast("تم إرسال الطلب للصيدليات التي اخترتها.", "success");
      });
      render();
    }
    if (form.dataset.form === "teacher-session-link") {
      if (CONFIG.isPublicPreview) throw new Error("الحفظ متوقف في نسخة المعاينة.");
      if (state.profile?.role !== "teacher") throw new Error("هذه العملية للمدرس فقط.");
      const url = safeMeetingUrl(new FormData(form).get("url"));
      if (!url) throw new Error("الرابط لازم يبدأ بـ \u2066https://\u2069 وبدون مسافات.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherSetSessionLink(form.dataset.sessionId, url);
        await loadSessionLinks();
        showToast("تم حفظ رابط الحصة. يراه المسجلون فقط.", "success");
      });
      render();
    }
    if (form.dataset.form === "teacher-session") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      if (state.profile?.role !== "teacher") throw new Error("هذه العملية للمدرس فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      await runWithBusyState(state, async () => {
        render();
        await dataApi.teacherCreateSession({ ...values, minutes: 60 });
        state.teacherSessions = await dataApi.getSessions(state.providerRecord.id);
        showToast("تمت إضافة الحصة.", "success");
      });
      render();
    }
    if (form.dataset.form === "store-order") {
      if (CONFIG.isPublicPreview) throw new Error("الطلب متوقف في نسخة المعاينة.");
      if (state.profile?.role !== "customer") throw new Error("الطلب متاح لحسابات العملاء فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.product) throw new Error("اختر المنتج.");
      if (values.terms !== "on" || values.privacy !== "on") throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
      await runWithBusyState(state, async () => {
        render();
        await dataApi.acceptRequiredConsents();
        await dataApi.placeProductOrder(values.product, values.qty, values.address, null);
        state.myOrders = await dataApi.getMyOrders(state.user.id);
        state.products = await dataApi.getProducts();
        showToast("تم استلام طلب المنتج.", "success");
      });
      render();
    }
    if (form.dataset.form === "password-reset") {
      const email = String(new FormData(form).get("email") || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("أدخل بريدًا إلكترونيًا صحيحًا.");
      await authApi.requestPasswordReset(email);
      state.modal = null;
      render();
      showToast("إذا كان البريد مسجلًا، ستصلك رسالة تحتوي على رابط الاستعادة.", "success");
    }
    if (form.dataset.form === "password-recovery") {
      const values = Object.fromEntries(new FormData(form).entries());
      const password = String(values.password || "");
      if (password.length < 8) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
      if (password !== String(values.confirm_password || "")) throw new Error("تأكيد كلمة المرور غير مطابق.");
      await authApi.updatePassword(password);
      try { await authApi.signOut(); } catch { /* Password change already succeeded; local session is cleared in signOut's finally block. */ }
      state.user = state.profile = state.session = null;
      state.modal = "auth";
      state.authMode = "login";
      render();
      showToast("تم تحديث كلمة المرور. سجل الدخول بكلمتك الجديدة.", "success");
    }
    if (form.dataset.form === "order") await submitOrder(form);
    if (form.dataset.form === "roadmap-milestone") await submitRoadmapMilestone(form);
    if (form.dataset.form === "crm-lead") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (String(values.full_name || "").trim().length < 2 || !String(values.phone || "").trim()) {
        throw new Error("أدخل اسم العميل ورقم هاتفه.");
      }
      state.crmSaving = true;
      render();
      try {
        await dataApi.createCrmLead(values);
        await refreshCrm();
        showToast("تمت إضافة العميل المحتمل.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "crm-lead-update") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      state.crmSaving = true;
      render();
      try {
        await dataApi.updateCrmLead(form.dataset.leadId, values.status);
        await refreshCrm();
        showToast("تم تحديث حالة العميل المحتمل.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "crm-task") {
      if (CONFIG.isPublicPreview) throw new Error("الإضافة متوقفة في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.customer_id) throw new Error("اختر العميل المرتبط بالمهمة.");
      state.crmSaving = true;
      render();
      try {
        await dataApi.createCrmTask(values);
        await refreshCrm();
        showToast("تم إنشاء المهمة.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "crm-interaction") {
      if (CONFIG.isPublicPreview) throw new Error("التسجيل متوقف في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      values.customer_id = form.dataset.customerId;
      if (!String(values.body || "").trim() && !String(values.subject || "").trim()) {
        throw new Error("أدخل ملخص التواصل أو تفاصيله.");
      }
      state.crmSaving = true;
      render();
      try {
        await dataApi.createCrmInteraction(values);
        state.crmCustomer360 = await dataApi.getCrmCustomer360(values.customer_id);
        await refreshCrm();
        showToast("تم تسجيل التواصل.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "crm-ticket") {
      if (CONFIG.isPublicPreview) throw new Error("فتح التذاكر متوقف في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.customer_id || String(values.description || "").trim().length < 5) {
        throw new Error("اختر العميل واكتب وصفًا واضحًا للتذكرة.");
      }
      state.crmSaving = true;
      render();
      try {
        await dataApi.createCrmTicket(values);
        await refreshCrm();
        showToast("تم فتح تذكرة الدعم وتسجيل الحدث.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "crm-ticket-update") {
      if (CONFIG.isPublicPreview) throw new Error("تحديث التذاكر متوقف في نسخة المعاينة.");
      const values = Object.fromEntries(new FormData(form).entries());
      state.crmSaving = true;
      render();
      try {
        await dataApi.updateCrmTicket(form.dataset.ticketId, values.status, "", "تحديث من لوحة CRM");
        await refreshCrm();
        showToast("تم تحديث التذكرة.", "success");
      } finally {
        state.crmSaving = false;
        render();
      }
    }
    if (form.dataset.form === "provider-invite") {
      if (CONFIG.isPublicPreview) throw new Error("تفعيل حسابات مقدمي الخدمة متوقف في نسخة المعاينة.");
      if (!state.user || state.profile?.role !== "customer") throw new Error("سجل الدخول بحساب عميل أولًا.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (String(values.code || "").trim().length < 6
        || String(values.display_name || "").trim().length < 2
        || String(values.specialty || "").trim().length < 2
        || String(values.area || "").trim().length < 2) {
        throw new Error("أكمل كود الدعوة والاسم والتخصص ومنطقة التغطية.");
      }
      state.providerInviteSaving = true;
      render();
      try {
        const kind = await dataApi.redeemProviderInvite(values);
        state.modal = null;
        await loadAccount();
        if (["doctor", "technician", "teacher", "courier", "merchant"].includes(kind)) {
          await refreshProvider();
          showToast("تم استلام طلب انضمامك. الحساب ينتظر اعتماد الإدارة.", "success");
        } else {
          render();
          showToast("تم تفعيل الدور المصرح به.", "success");
        }
      } finally {
        state.providerInviteSaving = false;
        render();
      }
    }
    if (form.dataset.form === "operations-provider-coverage") {
      if (CONFIG.isPublicPreview) throw new Error("إدارة التغطية متوقفة في نسخة المعاينة.");
      if (state.profile?.role !== "admin") throw new Error("إدارة التغطية مخصصة للمؤسس فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.provider_id || !values.service_item_id) throw new Error("اختر مقدم الخدمة والخدمة.");
      await dataApi.adminSetProviderServiceCoverage(values.provider_id, values.service_item_id, true);
      await Promise.all([refreshOperations(), loadCatalog()]);
      showToast("تم ربط مقدم الخدمة بالخدمة بعد التحقق من التخصص.", "success");
    }
    if (form.dataset.form === "operations-invite") {
      if (CONFIG.isPublicPreview) throw new Error("إنشاء الدعوات متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بإنشاء الدعوات.");
      const values = Object.fromEntries(new FormData(form).entries());
      state.operationsSaving = true;
      render();
      try {
        const code = await dataApi.createProviderInvite(values.kind);
        state.latestInviteCode = String(code || "").replace(/^"|"$/g, "");
        await refreshOperations();
        showToast("تم إنشاء كود الدعوة. أرسله لمقدم الخدمة بعد مراجعة بياناته.", "success");
      } finally {
        state.operationsSaving = false;
        render();
      }
    }
    if (form.dataset.form === "operations-service-price") {
      if (CONFIG.isPublicPreview) throw new Error("تعديل أسعار الخدمات متوقف في نسخة المعاينة.");
      if (state.profile?.role !== "admin") throw new Error("تعديل أسعار الخدمات مخصص للمؤسس فقط.");
      const values = Object.fromEntries(new FormData(form).entries());
      const rawPrice = String(values.price ?? "").trim();
      const price = rawPrice === "" ? null : Number(rawPrice);
      if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10000000)) {
        throw new Error("أدخل سعرًا صحيحًا أو اترك الحقل فارغًا للتسعير بعد المعاينة.");
      }
      state.operationsSaving = true;
      render();
      try {
        await dataApi.adminUpdateServicePrice(form.dataset.itemId, price);
        await Promise.all([refreshOperations(), loadCatalog()]);
        showToast("تم تحديث سعر الخدمة وتسجيل التغيير.", "success");
      } finally {
        state.operationsSaving = false;
        render();
      }
    }
    if (form.dataset.form === "operations-quote") {
      if (CONFIG.isPublicPreview) throw new Error("تعديل الأسعار متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بإرسال عرض سعر.");
      const values = Object.fromEntries(new FormData(form).entries());
      state.operationsSaving = true;
      render();
      try {
        await dataApi.quoteOrder(form.dataset.orderId, values.price);
        showToast("تم إرسال عرض السعر للعميل. لن يتأكد الطلب إلا بعد موافقته.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    }
    if (form.dataset.form === "delivery-assign") {
      if (CONFIG.isPublicPreview) throw new Error("التعيين متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بتعيين المندوب.");
      const values = Object.fromEntries(new FormData(form).entries());
      await runWithBusyState(state, async () => {
        render();
        await dataApi.assignDelivery(form.dataset.requestId, values.courier_id);
        state.deliveryQueue = await dataApi.getDeliveryQueue();
        showToast("تم تعيين المندوب.", "success");
      });
      render();
    }
    if (form.dataset.form === "operations-schedule") {
      if (CONFIG.isPublicPreview) throw new Error("التعديل متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بتحديد الموعد.");
      const data = new FormData(form);
      state.operationsSaving = true;
      render();
      try {
        await dataApi.staffScheduleOrder({ orderId: form.dataset.orderId, value: data.get("scheduled_at") });
        showToast("تم تحديد الموعد المؤكد.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    }
    if (form.dataset.form === "operations-assign") {
      if (CONFIG.isPublicPreview) throw new Error("التعيين متوقف في نسخة المعاينة.");
      if (!["staff", "admin"].includes(state.profile?.role)) throw new Error("غير مصرح بتعيين مقدم الخدمة.");
      const values = Object.fromEntries(new FormData(form).entries());
      state.operationsSaving = true;
      render();
      try {
        await dataApi.assignOrder(form.dataset.orderId, values.provider_id);
        showToast("تم تعيين مقدم الخدمة.", "success");
        await refreshOperations();
      } finally {
        state.operationsSaving = false;
        render();
      }
    }
  } catch (error) {
    render();
    showToast(error.message || "تعذر إكمال العملية.", "error");
  }
});

root.addEventListener("change", async (event) => {
  const pick = event.target.closest?.("[data-clinic-pick]");
  if (!pick) return;
  if (state.busy) return;
  if (pick.dataset.clinicPick === "doctor") state.clinicDoctorId = pick.value;
  if (pick.dataset.clinicPick === "day") state.clinicDay = pick.value;
  await loadClinicSlots();
  render();
});

root.addEventListener("input", (event) => {
  if (event.target.matches('input[name="address"]')) {
    state.pendingAddress = event.target.value;
    return;
  }
  if (!event.target.matches("[data-search]")) return;
  const cursor = event.target.selectionStart;
  state.search = event.target.value;
  render();
  const next = root.querySelector("[data-search]");
  next?.focus();
  if (cursor !== null) next?.setSelectionRange(cursor, cursor);
});

async function init() {
  let oauthError = "";
  const authSettingsPromise = authApi.getAuthSettings().catch(() => null);
  try {
    const oauthResult = await authApi.acceptOAuthFromUrl();
    oauthError = oauthResult?.error || "";
  } catch (error) {
    oauthError = error.message || "تعذر إكمال تسجيل Google.";
  }
  const signupConfirmed = authApi.acceptSignupFromUrl();
  const recoveryLink = authApi.acceptRecoveryFromUrl();
  if (recoveryLink) state.modal = "password-recovery";
  render();
  const [authSettings] = await Promise.all([
    authSettingsPromise,
    loadCatalog(),
    loadAccount(),
    loadRoadmap()
  ]);
  state.googleAuthEnabled = Boolean(authSettings?.external?.google);
  state.phoneAuthReady = isPhoneAliasSignupReady(authSettings);

  const pendingServiceId = recoveryLink ? null : localStorage.getItem(PENDING_ORDER_SERVICE_KEY);
  if (pendingServiceId) {
    const pendingService = filterOrderableServices(state.services)
      .find((service) => String(service.id) === pendingServiceId);
    if (!pendingService) {
      localStorage.removeItem(PENDING_ORDER_SERVICE_KEY);
    } else if (state.profile?.role === "customer") {
      state.pendingService = pendingService;
      state.modal = "order";
    } else if (!state.user) {
      state.pendingService = pendingService;
      state.authMode = "register";
      state.modal = "auth";
    } else {
      localStorage.removeItem(PENDING_ORDER_SERVICE_KEY);
    }
  }

  if (oauthError) showToast(oauthError, "error");
  if (signupConfirmed) {
    showToast("تم تأكيد بريدك الإلكتروني. أكمل بيانات الطلب.", "success");
  }
  if (state.profile?.role === "admin") await loadRoadmapAudit();

  if (["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role) && state.view === "home") {
    state.view = "provider";
  }

  if (state.view === "operations" && ["staff", "admin"].includes(state.profile?.role)) {
    try {
      const [orders, providers, services, coverage] = await Promise.all([
        dataApi.getOperationsOrders(),
        dataApi.getOperationsProviders(),
        state.profile?.role === "admin" ? dataApi.getOperationsServices() : Promise.resolve([]),
        state.profile?.role === "admin" ? dataApi.getOperationsCoverage() : Promise.resolve([])
      ]);
      state.operationsOrders = Array.isArray(orders) ? orders : [];
      state.operationsProviders = Array.isArray(providers) ? providers : [];
      state.operationsServices = Array.isArray(services) ? services : [];
      state.operationsCoverage = Array.isArray(coverage) ? coverage : [];
    } catch (error) {
      showToast(error.message, "error");
    }
  } else if (state.view === "operations") {
    state.view = "home";
  } else if (state.view === "crm" && ["staff", "admin"].includes(state.profile?.role)) {
    await refreshCrm();
  } else if (state.view === "crm") {
    state.view = "home";
  } else if (state.view === "provider" && ["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role)) {
    const result = await dataApi.getProviderWorkspace().catch((error) => {
      state.providerError = error.message || "تعذر تحميل مساحة مقدم الخدمة.";
      return { provider: null, orders: [] };
    });
    state.providerRecord = result.provider || null;
    state.providerOrders = Array.isArray(result.orders) ? result.orders : [];
  } else if (state.view === "provider") {
    state.view = "home";
  }

  render();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline install is optional; the online app remains usable.
    });
  }
}

init();
