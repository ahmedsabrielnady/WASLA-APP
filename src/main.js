import { CONFIG } from "./config.js";
import { SECTORS, canRequestService, escapeHTML, formatDate, formatEGP, isEgyptianPhone, isValidAddress, sectorLabel, statusLabel } from "./domain.js";
import { authApi, dataApi } from "./supabase.js";

const root = document.querySelector("#app");
const state = {
  services: [],
  offers: [],
  user: null,
  profile: null,
  session: null,
  view: new URLSearchParams(location.search).get("view") === "operations" ? "operations" : "home",
  modal: null,
  authMode: "login",
  pendingService: null,
  search: "",
  myOrders: [],
  operationsOrders: [],
  busy: false,
  loadError: ""
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
  const messages = state.offers.length
    ? state.offers.map((offer) => offer.text)
    : ["وصلة تجمع خدماتك المحلية في مكان واحد", "خدمات شبين القناطر أقرب وأسهل مع وصلة"];

  const text = messages.map((message) => escapeHTML(message)).join("　　✦　　");
  return `
    <div class="ticker" aria-label="إعلانات المنصة">
      <div class="ticker-track"><span>${text}</span><span aria-hidden="true">${text}</span></div>
    </div>
    <p class="ticker-note">الإعلانات المعروضة نصوص منشورة من لوحة المنصة؛ لا يُحتسب خصم تلقائي قبل تفعيل محرك العروض.</p>
  `;
}

function header() {
  const displayName = state.profile?.full_name || state.user?.email || "حسابي";
  const authenticated = Boolean(state.user);
  const isStaff = ["staff", "admin"].includes(state.profile?.role);

  return `
    <header class="topbar">
      <a class="brand" href="./" data-action="home" aria-label="وصلة - الرئيسية">
        <span class="brand-mark">و</span>
        <span><strong>وصلة</strong><small>WASLA · شبين القناطر</small></span>
      </a>
      <nav class="top-actions" aria-label="القائمة الرئيسية">
        <button class="nav-link" data-action="orders" ${authenticated ? "" : "disabled"}>طلباتي</button>
        ${isStaff ? '<button class="nav-link" data-action="operations">التشغيل</button>' : ""}
        ${authenticated
          ? `<button class="account-chip" data-action="account" title="الحساب">${icon("👤")}<span>${escapeHTML(displayName)}</span></button><button class="btn btn-outline btn-small" data-action="logout">خروج</button>`
          : '<button class="btn btn-primary btn-small" data-action="auth">دخول / حساب جديد</button>'}
      </nav>
    </header>
  `;
}

function sectorCards() {
  return SECTORS.map((sector) => {
    const count = state.services.filter((item) => item.sector === sector.code).length;
    let badge = "قريبًا";
    let detail = sector.description;

    if (sector.mode === "order") {
      badge = count ? `${count} خدمات متاحة للطلب` : "الخدمات قيد الإضافة";
    } else if (sector.mode === "review") {
      badge = "قيد استكمال التشغيل";
      detail = sector.code === "clinic"
        ? "لن نعرض مواعيد قبل اعتماد جداول العيادات"
        : "تفعيل التوصيل والتتبع بعد تجهيز دورة الشحنات";
    }

    return `
      <button class="sector-card ${sector.mode === "soon" ? "is-soon" : ""}" data-action="sector" data-sector="${sector.code}">
        <span class="sector-icon">${sector.icon}</span>
        <strong>${escapeHTML(sector.title)}</strong>
        <span class="sector-description">${escapeHTML(detail)}</span>
        <span class="sector-badge">${escapeHTML(badge)}</span>
      </button>
    `;
  }).join("");
}

function serviceCards() {
  const search = state.search.trim().toLocaleLowerCase("ar");
  const filtered = state.services.filter((item) => {
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
        <div class="hero-logo">و</div>
        <span class="float-icon float-one">🩺</span><span class="float-icon float-two">🚗</span><span class="float-icon float-three">🧰</span>
      </div>
      <div class="hero-location">📍 شبين القناطر · القليوبية</div>
    </section>

    ${offerTicker()}

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

function orderCard(order) {
  const price = order.price_egp === null ? "السعر لم يحدد" : formatEGP(order.price_egp);
  return `
    <article class="order-card">
      <div class="order-card-top"><strong>${escapeHTML(order.ref || "طلب وصلة")}</strong><span class="status-pill">${escapeHTML(statusLabel(order.status))}</span></div>
      <div class="order-name">${escapeHTML(sectorLabel(order.sector))}</div>
      <div class="order-meta"><span>${escapeHTML(formatDate(order.created_at))}</span><strong>${escapeHTML(price)}</strong></div>
      ${Number(order.deposit_egp) > 0 ? `<p class="deposit-note">عربون مسجل: ${escapeHTML(formatEGP(order.deposit_egp))} · ${order.deposit_paid ? "مدفوع" : "غير مسدد"}</p>` : ""}
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
  if (!["staff", "admin"].includes(state.profile?.role)) {
    return '<section class="page-panel"><h1>لوحة التشغيل</h1><div class="empty-state"><strong>غير مصرح</strong><p>هذه الصفحة مخصصة للحسابات الإدارية المعتمدة.</p></div></section>';
  }

  const orders = state.operationsOrders;
  const activeCount = orders.filter((order) => !["done", "cancelled"].includes(order.status)).length;
  const completedCount = orders.filter((order) => order.status === "done").length;

  return `
    <section class="page-panel">
      <div class="section-heading"><div><span class="eyebrow">للموظفين المخولين فقط</span><h1>لوحة التشغيل</h1></div><button class="btn btn-outline btn-small" data-action="reload-operations">تحديث</button></div>
      <div class="stats-grid">
        <div class="stat-card"><span>الطلبات المعروضة</span><strong>${orders.length}</strong></div>
        <div class="stat-card"><span>قيد التنفيذ</span><strong>${activeCount}</strong></div>
        <div class="stat-card"><span>مكتملة</span><strong>${completedCount}</strong></div>
      </div>
      <p class="notice">عرض تشغيلي للقراءة فقط. تغيير الحالات والصلاحيات المالية سيضاف بعد اختبارات أوسع لدوال التشغيل.</p>
      ${orders.length
        ? `<div class="orders-list">${orders.map(orderCard).join("")}</div>`
        : '<div class="empty-state"><strong>لا توجد طلبات</strong><p>ستظهر الطلبات هنا عند وصولها.</p></div>'}
    </section>
  `;
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
            <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على شروط الاستخدام.</span></label>
            <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على سياسة الخصوصية.</span></label>
          ` : ""}
          <button class="btn btn-primary btn-block" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ التنفيذ..." : (register ? "إنشاء الحساب" : "تسجيل الدخول")}</button>
        </form>
        <button class="switch-auth" data-action="switch-auth">${register ? "لديك حساب بالفعل؟ تسجيل الدخول" : "ليس لديك حساب؟ إنشاء حساب جديد"}</button>
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
          <label>عنوان تنفيذ الخدمة<input name="address" required minlength="4" maxlength="255" autocomplete="street-address" placeholder="الشارع والمنطقة ورقم العقار"></label>
          <label>ملاحظات إضافية<textarea name="notes" maxlength="500" rows="3" placeholder="تفاصيل تساعد مقدم الخدمة"></textarea></label>
          <div class="consent-panel">
            <label class="check-row"><input type="checkbox" name="terms" required><span>أوافق على شروط الاستخدام.</span></label>
            <label class="check-row"><input type="checkbox" name="privacy" required><span>أوافق على سياسة الخصوصية.</span></label>
          </div>
          <p class="form-footnote">إرسال الطلب لا يعني تنفيذ الدفع الإلكتروني. أي عربون أو تكلفة إضافية يتم توضيحها قبل التنفيذ.</p>
          <button class="btn btn-primary btn-block" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "جارٍ إرسال الطلب..." : "تأكيد إرسال الطلب"}</button>
        </form>
      </section>
    </div>
  `;
}

function modalView() {
  if (state.modal === "auth") return authModal();
  if (state.modal === "order") return orderModal();
  return "";
}

function render() {
  const view = state.view === "orders" ? ordersView()
    : state.view === "operations" ? operationsView()
    : homeView();

  root.innerHTML = `
    ${header()}
    <main class="app-main">${view}</main>
    <footer class="site-footer">
      <div class="footer-brand"><span class="brand-mark small">و</span><strong>وصلة WASLA</strong></div>
      <p>وصلة مش فاصلة، وصلة شغالة.</p>
      <small>نسخة تشغيل أولية · شبين القناطر · ${new Date().getFullYear()}</small>
    </footer>
    ${modalView()}
  `;
}

async function loadCatalog() {
  state.loadError = "";
  try {
    const [services, offers] = await Promise.all([
      dataApi.getServices(),
      dataApi.getOffers()
    ]);
    state.services = Array.isArray(services) ? services : [];
    state.offers = Array.isArray(offers) ? offers : [];
  } catch (error) {
    state.loadError = error.message || "تعذر تحميل البيانات.";
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
  if (!state.user) {
    state.pendingService = item;
    openAuth("login");
    return;
  }
  state.pendingService = item;
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
    state.operationsOrders = await dataApi.getOperationsOrders();
    state.view = "operations";
  } catch (error) {
    showToast(error.message, "error");
  }
  render();
}

async function afterLogin() {
  state.session = await authApi.getSession();
  state.user = await authApi.getUser();
  state.profile = await dataApi.getProfile(state.user.id);
  await dataApi.completePendingConsent();

  state.modal = null;
  if (state.pendingService) {
    state.modal = "order";
  } else {
    state.view = "home";
  }
  render();
}

async function submitAuth(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const email = String(values.email ?? "").trim();
  const password = String(values.password ?? "");

  if (!email || !password) throw new Error("أدخل البريد الإلكتروني وكلمة المرور.");

  state.busy = true;
  render();

  if (state.authMode === "login") {
    await authApi.signIn(email, password);
    await afterLogin();
    showToast("تم تسجيل الدخول.", "success");
    return;
  }

  const fullName = String(values.full_name ?? "").trim();
  const phone = String(values.phone ?? "").trim();

  if (fullName.length < 2 || fullName.length > 60) {
    throw new Error("اكتب الاسم من حرفين إلى 60 حرفًا.");
  }
  if (!isEgyptianPhone(phone)) {
    throw new Error("رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01.");
  }
  if (values.terms !== "on" || values.privacy !== "on") {
    throw new Error("يجب الموافقة على الشروط وسياسة الخصوصية.");
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
}

async function submitOrder(form) {
  const values = Object.fromEntries(new FormData(form).entries());
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

  state.busy = true;
  render();

  await dataApi.acceptRequiredConsents();
  const result = await dataApi.createServiceOrder(state.pendingService, {
    address: values.address,
    notes: values.notes
  });
  const record = Array.isArray(result) ? result[0] : result;

  state.modal = null;
  state.pendingService = null;
  state.myOrders = await dataApi.getMyOrders(state.user.id);
  state.view = "orders";
  render();
  showToast(record?.out_ref ? `تم استلام طلبك رقم ${record.out_ref}` : "تم استلام طلبك.", "success");
}

root.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "backdrop" && event.target !== button) return;

  try {
    if (action === "auth") openAuth("login");
    else if (action === "close-modal" || action === "backdrop") {
      state.modal = null;
      render();
    } else if (action === "switch-auth") {
      state.authMode = state.authMode === "login" ? "register" : "login";
      render();
    } else if (action === "logout") {
      await authApi.signOut();
      state.user = state.profile = state.session = null;
      state.myOrders = [];
      state.view = "home";
      render();
      showToast("تم تسجيل الخروج.", "success");
    } else if (action === "orders" || action === "reload-orders") {
      await refreshMyOrders();
    } else if (action === "operations" || action === "reload-operations") {
      await refreshOperations();
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
    if (form.dataset.form === "order") await submitOrder(form);
  } catch (error) {
    state.busy = false;
    render();
    showToast(error.message || "تعذر إكمال العملية.", "error");
  } finally {
    state.busy = false;
  }
});

root.addEventListener("input", (event) => {
  if (!event.target.matches("[data-search]")) return;
  const cursor = event.target.selectionStart;
  state.search = event.target.value;
  render();
  const next = root.querySelector("[data-search]");
  next?.focus();
  if (cursor !== null) next?.setSelectionRange(cursor, cursor);
});

async function init() {
  render();
  await Promise.all([loadCatalog(), loadAccount()]);

  if (state.view === "operations" && ["staff", "admin"].includes(state.profile?.role)) {
    try {
      state.operationsOrders = await dataApi.getOperationsOrders();
    } catch (error) {
      showToast(error.message, "error");
    }
  } else if (state.view === "operations") {
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
