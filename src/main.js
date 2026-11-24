import { CONFIG } from "./config.js";
import { SECTORS, canRequestService, filterOrderableServices, escapeHTML, formatDate, formatEGP, isEgyptianPhone, isValidAddress, isValidCoordinates, runWithBusyState, sectorLabel, statusLabel, validateRoadmapUpdate } from "./domain.js";
import { authApi, dataApi } from "./supabase.js";
import { renderRoadmapHome, renderRoadmapPage } from "./roadmap.js";
import { renderOperationsView } from "./operations.js";
import { renderCrmView } from "./crm.js";
import { renderProviderView } from "./provider.js";

const root = document.querySelector("#app");
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
  pendingService: null,
  pendingLocation: null,
  pendingAddress: "",
  search: "",
  myOrders: [],
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
        <button class="nav-link" data-action="orders" ${authenticated ? "" : "disabled"}>طلباتي</button>
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
          <button class="btn btn-glass" data-action="orders">تابع طلباتك</button>
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
  const queue = tracking.sector === "clinic" && Number.isFinite(Number(tracking.queue_position))
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

function orderCard(order) {
  const price = order.price_egp === null ? "السعر لم يحدد" : formatEGP(order.price_egp);
  return `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(order.ref || "طلب وصلة")}</strong><span class="status-pill">${escapeHTML(statusLabel(order.status))}</span></div>
      <div class="order-name">${escapeHTML(sectorLabel(order.sector))}</div>
      <div class="order-meta"><span>${escapeHTML(formatDate(order.created_at))}</span><strong>${escapeHTML(price)}</strong></div>
      ${Number(order.deposit_egp) > 0 ? `<p class="deposit-note">عربون مسجل: ${escapeHTML(formatEGP(order.deposit_egp))} · ${order.deposit_paid ? "مدفوع" : "غير مسدد"}</p>` : ""}
      ${Number.isFinite(Number(order.lat)) && Number.isFinite(Number(order.lng)) ? '<p class="location-note">📍 تم تسجيل إحداثيات موقع التنفيذ</p>' : ""}
      <div class="order-card-actions">
        <button class="btn btn-outline btn-small" data-action="track-order" data-order-id="${escapeHTML(order.id)}" ${state.trackingLoadingId === order.id ? "disabled" : ""}>${state.trackingOrderId === order.id ? "إخفاء التفاصيل" : "متابعة الطلب"}</button>
        ${order.status === "new" ? `<button class="btn btn-outline btn-small" data-action="customer-cancel-order" data-order-id="${escapeHTML(order.id)}" ${state.busy || CONFIG.isPublicPreview ? "disabled" : ""}>إلغاء الطلب قبل التأكيد</button>` : ""}
      </div>
      ${orderTrackingPanel(order)}
    </article>
  `;
}

function ordersView() {
  if (!state.user) {
    return '<section class="page-panel"><h1>طلباتي</h1><p>سجل الدخول لمشاهدة طلباتك.</p><button class="btn btn-primary" data-action="auth">تسجيل الدخول</button></section>';
  }

  return `
    <section class="page-panel">
      <div class="section-heading"><div><span class="eyebrow">حساب العميل</span><h1>طلباتي</h1></div><button class="btn btn-outline btn-small" data-action="reload-orders">تحديث</button></div>
      ${state.myOrders.length
        ? `<div class="orders-list">${state.myOrders.map(orderCard).join("")}</div>`
        : '<div class="empty-state"><strong>لا توجد طلبات بعد</strong><p>عندما ترسل أول طلب ستظهر حالته هنا.</p><button class="btn btn-primary" data-action="home">اكتشف الخدمات</button></div>'}
    </section>
  `;
}

function operationsView() {
  return renderOperationsView({
    profile: state.profile,
    orders: state.operationsOrders,
    providers: state.operationsProviders,
    services: state.operationsServices,
    latestInviteCode: state.latestInviteCode,
    coverage: state.operationsCoverage,
    preview: CONFIG.isPublicPreview,
    saving: state.operationsSaving
  });
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
  });
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
        <p class="modal-subtitle">${register ? "أنشئ حسابًا لتسجيل طلباتك ومتابعتها." : "سجل الدخول لعرض الطلبات وإرسال خدمة."}</p>
        <form data-form="auth" novalidate>
          ${register ? `
            <label>الاسم بالكامل<input name="full_name" required minlength="2" maxlength="60" autocomplete="name" placeholder="الاسم بالكامل"></label>
            <label>رقم الموبايل<input name="phone" required inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="01xxxxxxxxx"></label>
          ` : ""}
          <label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email" placeholder="name@example.com"></label>
          <label>كلمة المرور<input name="password" type="password" required minlength="8" autocomplete="${register ? "new-password" : "current-password"}" placeholder="8 أحرف على الأقل"></label>
          ${register ? `
            <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على <a href="./terms.html" target="_blank" rel="noopener">شروط الاستخدام (مسودة)</a>.</span></label>
            <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على <a href="./privacy.html" target="_blank" rel="noopener">سياسة الخصوصية (مسودة)</a>.</span></label>
          ` : ""}
          <button class="btn btn-primary btn-block" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ التنفيذ..." : (register ? "إنشاء الحساب" : "تسجيل الدخول")}</button>
        </form>
        ${!register && !CONFIG.isPublicPreview ? '<button class="switch-auth" data-action="forgot-password">نسيت كلمة المرور؟</button>' : ""}
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
    ${CONFIG.isPublicPreview ? '<div class="preview-banner" role="note">نسخة معاينة — يمكنك تصفح الخدمات وتسجيل الدخول للقراءة، لكن إنشاء الحسابات والطلبات وحفظ الموافقات متوقف لحماية قاعدة البيانات الحية.</div>' : ""}
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
    await dataApi.completePendingConsent();
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
  root.querySelector('input[name="email"]')?.focus();
}

function openOrder(item) {
  state.pendingOrderIdempotencyKey = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `wsl-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  if (!state.user) {
    state.pendingService = item;
    openAuth("login");
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
  try {
    state.myOrders = await dataApi.getMyOrders(state.user.id);
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
  await dataApi.completePendingConsent();
  if (state.profile?.role === "admin") await loadRoadmapAudit();

  state.modal = null;
  if (state.pendingService) {
    state.modal = "order";
    render();
  } else if (["doctor", "technician", "teacher", "courier", "merchant"].includes(state.profile?.role)) {
    await refreshProvider();
  } else {
    state.view = "home";
    render();
  }
}

async function submitAuth(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const email = String(values.email ?? "").trim();
  const password = String(values.password ?? "");
  const register = state.authMode === "register";

  if (!email || !password) throw new Error("أدخل البريد الإلكتروني وكلمة المرور.");

  let fullName = "";
  let phone = "";
  if (register) {
    fullName = String(values.full_name ?? "").trim();
    phone = String(values.phone ?? "").trim();

    if (fullName.length < 2 || fullName.length > 60) {
      throw new Error("اكتب الاسم من حرفين إلى 60 حرفًا.");
    }
    if (!isEgyptianPhone(phone)) {
      throw new Error("رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.");
    }
    if (values.terms !== "on" || values.privacy !== "on") {
      throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
    }
  }

  await runWithBusyState(state, async () => {
    render();

    if (!register) {
      await authApi.signIn(email, password);
      await afterLogin();
      showToast("تم تسجيل الدخول.", "success");
      return;
    }

    dataApi.markConsentPending();
    const result = await authApi.signUp({ email, password, fullName, phone });

    if (result?.access_token) {
      await afterLogin();
      showToast("تم إنشاء الحساب وتسجيل الموافقات.", "success");
    } else {
      state.modal = null;
      render();
      showToast("تم إنشاء الحساب. أكد بريدك الإلكتروني ثم سجل الدخول لحفظ الموافقات وإكمال التسجيل.", "success");
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
      render();
    } else if (action === "switch-auth") {
      state.authMode = state.authMode === "login" ? "register" : "login";
      render();
    } else if (action === "forgot-password") {
      state.modal = "password-reset";
      render();
      root.querySelector('input[name="email"]')?.focus();
    } else if (action === "logout") {
      await authApi.signOut();
      state.user = state.profile = state.session = null;
      state.myOrders = [];
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
    } else if (action === "track-order") {
      if (!state.user?.id) throw new Error("سجل الدخول لمتابعة الطلب.");
      const orderId = button.dataset.orderId;
      if (!orderId) throw new Error("الطلب غير محدد.");
      if (state.trackingOrderId === orderId) {
        state.trackingOrderId = "";
        state.orderTracking = null;
        state.trackingError = "";
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
    } else if (action === "customer-cancel-order") {
      if (!state.user?.id) throw new Error("سجل الدخول لإلغاء الطلب.");
      if (CONFIG.isPublicPreview) throw new Error("إلغاء الطلبات متوقف في نسخة المعاينة.");
      const orderId = button.dataset.orderId;
      if (!orderId) throw new Error("الطلب غير محدد.");
      if (!window.confirm("هل تريد إلغاء الطلب؟ يمكن الإلغاء قبل تأكيده فقط.")) return;
      await runWithBusyState(state, async () => {
        render();
        await dataApi.customerCancelOrder(orderId, "إلغاء بطلب العميل من صفحة طلباتي");
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
      const label = nextStatus === "done" ? "تأكيد إتمام الخدمة" : "بدء التنفيذ";
      if (!window.confirm("هل تريد " + label + "؟")) return;
      state.providerSaving = true;
      render();
      try {
        await dataApi.providerSetOrderStatus(orderId, nextStatus, "تم تحديث الحالة من مساحة مقدم الخدمة");
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
    state.busy = false;
    render();
    showToast(error.message || "حدث خطأ غير متوقع.", "error");
  }
});

root.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();

  try {
    if (form.dataset.form === "auth") await submitAuth(form);
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
        showToast("تم حفظ عرض السعر وتحديث حالة الطلب حسب قواعد التشغيل.", "success");
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
    state.busy = false;
    render();
    showToast(error.message || "تعذر إكمال العملية.", "error");
  } finally {
    state.busy = false;
  }
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
  const recoveryLink = authApi.acceptRecoveryFromUrl();
  if (recoveryLink) state.modal = "password-recovery";
  render();
  await Promise.all([loadCatalog(), loadAccount(), loadRoadmap()]);
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
