import { escapeHTML, formatDate, formatEGP, pageSlice, sectorLabel, statusLabel } from "./domain.js";

const PROVIDER_ROLES = new Set(["doctor", "technician", "teacher", "courier", "merchant"]);
const KIND_LABELS = Object.freeze({
  doctor: "طبيب",
  technician: "فني",
  teacher: "معلم",
  courier: "مندوب",
  merchant: "تاجر"
});

function e(value) {
  return escapeHTML(value == null ? "" : value);
}

function geoCardHtml(card) {
  if (!card) return "";
  if (card.loading) return '<p class="geo-hint">جارٍ تحميل الموقع...</p>';
  if (card.error) return '<p class="form-error">' + e(card.error) + '</p>';
  return card.html || "";
}

function clinicLocationCard(provider, draft, disabled) {
  if (!provider || provider.kind !== "doctor") return "";
  const d = draft || { lat: "", lng: "", address: "", saved: false };
  return '<div class="geo-card clinic-location-card" data-clinic-location>' +
    '<strong>موقع العيادة</strong>' +
    '<p class="geo-hint">' + (d.saved ? "هذا الموقع يظهر للعملاء عند اختيارك للحجز. اسحب الدبوس أو اضغط على الخريطة لتعديله." : "لم تحدد موقع العيادة بعد. استخدم موقعك الحالي أو حرّك الدبوس على الخريطة، ثم اكتب العنوان واحفظ.") + '</p>' +
    '<div class="geo-map geo-picker" data-clinic-picker aria-label="خريطة موقع العيادة"></div>' +
    '<label>عنوان العيادة<input data-clinic-address maxlength="255" value="' + e(d.address) + '" placeholder="الشارع، المنطقة، علامة مميزة"></label>' +
    '<div class="geo-actions"><button class="btn btn-outline btn-small" data-action="clinic-use-gps"' + (disabled ? " disabled" : "") + '>استخدم موقعي الحالي</button>' +
    '<button class="btn btn-primary btn-small" data-action="clinic-save-location"' + (disabled ? " disabled" : "") + '>حفظ موقع العيادة</button></div></div>';
}

export function renderProviderView(options = {}) {
  const profile = options.profile || null;
  const provider = options.provider || null;
  const orders = Array.isArray(options.orders) ? options.orders : [];
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 10;
  const preview = Boolean(options.preview);
  const saving = Boolean(options.saving);
  const error = String(options.error || "");
  const geoCards = options.geoCards || {};

  if (!PROVIDER_ROLES.has(profile?.role)) {
    return '<section class="page-panel"><h1>مساحة مقدم الخدمة</h1><div class="empty-state"><strong>غير مصرح</strong><p>هذه المساحة مخصصة لحسابات مقدمي الخدمة المسجلة.</p></div></section>';
  }

  if (!provider) {
    return '<section class="page-panel provider-page"><h1>مساحة مقدم الخدمة</h1><div class="empty-state"><strong>ملف مقدم الخدمة غير موجود</strong><p>تواصل مع إدارة وصلة لاستكمال تسجيل ملفك المهني وربطه بحسابك.</p></div></section>';
  }

  if (provider.is_test) {
    return '<section class="page-panel provider-page"><h1>مساحة مقدم الخدمة</h1><div class="empty-state"><strong>هذا حساب تجريبي</strong><p>لا يمكن استخدام الحسابات التجريبية لاستلام طلبات العملاء.</p></div></section>';
  }

  if (!provider.approved || !provider.active) {
    return '<section class="page-panel provider-page"><span class="eyebrow">تفعيل الحساب</span><h1>أهلًا ' + e(provider.display_name) + '</h1><div class="empty-state"><strong>' + (provider.approved ? "حسابك غير نشط حاليًا" : "حسابك بانتظار مراجعة الإدارة") + '</strong><p>لن تظهر لك طلبات العملاء قبل اعتماد ملفك وتفعيل حسابك من إدارة وصلة.</p></div></section>';
  }

  const assigned = orders.filter((order) => !["done", "cancelled"].includes(order.status)).length;
  const completed = orders.filter((order) => order.status === "done").length;
  const ordersPage = pageSlice(orders, limit);
  const cards = ordersPage.items.map((order) => {
    const isClinic = order.sector === "clinic";
    const action = isClinic
      ? ({ new: ["confirmed", "تأكيد الموعد"], confirmed: ["in_progress", "بدء الكشف"], in_progress: ["done", "إنهاء الكشف"] })[order.status] || null
      : order.status === "confirmed"
      ? ["in_progress", "بدء التنفيذ"]
      : order.status === "in_progress"
        ? ["done", "تأكيد إتمام الخدمة"]
        : null;
    const isNewStore = order.sector === "store" && order.product_id != null && order.status === "new";
    const storeMarkup = isNewStore
      ? '<button class="btn btn-primary btn-small" data-action="store-respond" data-accept="yes" data-order-id="' + e(order.id) + '"' + (preview || saving ? " disabled" : "") + '>قبول الطلب</button> ' +
        '<button class="btn btn-outline btn-small" data-action="store-respond" data-accept="no" data-order-id="' + e(order.id) + '"' + (preview || saving ? " disabled" : "") + '>رفض الطلب</button>'
      : "";
    const actionMarkup = storeMarkup ? storeMarkup : action
      ? '<button class="btn btn-primary btn-small" data-action="provider-set-status" data-kind="' + (isClinic ? "clinic" : "order") + '" data-order-id="' + e(order.id) + '" data-status="' + action[0] + '"' + (preview || saving ? " disabled" : "") + '>' + action[1] + '</button>'
      : "";

    return '<article class="provider-order-card">' +
      '<div class="provider-order-head"><div><strong>' + e(order.ref || "طلب وصلة") + '</strong><small>' + e(sectorLabel(order.sector)) + '</small>' + (order.product_id != null ? '<small class="provider-order-product">' + e(order.product_name || "منتج") + ' × ' + e(String(Number(order.quantity) || 1)) + '</small>' : "") + '</div>' +
      '<span class="status-pill">' + e(statusLabel(order.status)) + '</span></div>' +
      '<div class="provider-order-meta">' +
      '<span>تاريخ الطلب: ' + e(formatDate(order.created_at)) + '</span>' +
      '<span>العنوان: ' + e(order.address || "لم يسجل عنوان") + '</span>' +
      '<span>السعر: ' + (order.price_egp == null ? "غير محدد" : e(formatEGP(order.price_egp))) + '</span>' +
      (order.scheduled_at ? '<span>الموعد: ' + e(formatDate(order.scheduled_at)) + '</span>' : "") +
      (order.notes ? '<span>ملاحظات العميل: ' + e(order.notes) + '</span>' : "") +
      '</div>' + (!["done", "cancelled"].includes(order.status) && order.sector !== "clinic" ? '<div class="provider-order-actions"><button class="btn btn-outline btn-small" data-action="geo-open" data-order-id="' + e(order.id) + '">موقع العميل والاتجاهات</button></div>' + geoCardHtml(geoCards[order.id]) : "") + (actionMarkup ? '<div class="provider-order-actions">' + actionMarkup + '</div>' : "") +
      '</article>';
  }).join("") + (ordersPage.remaining ? '<button class="btn btn-outline btn-small" data-action="more-list" data-list-key="providerOrders">عرض ' + ordersPage.remaining + ' أخرى</button>' : "");

  return '<section class="page-panel provider-page">' +
    '<div class="section-heading"><div><span class="eyebrow">مساحة مقدم الخدمة</span><h1>أهلًا ' + e(provider.display_name) + '</h1>' +
    '<p class="provider-subtitle">' + e(KIND_LABELS[provider.kind] || "مقدم خدمة") + ' · ' + e(provider.specialty || provider.area || "وصلة") + '</p></div>' +
    '<button class="btn btn-outline btn-small" data-action="reload-provider">تحديث الطلبات</button></div>' +
    '<div class="geo-card geo-phone"><label>رقم موبايل التواصل (يظهر للعميل أثناء تنفيذ طلبه فقط)<input name="provider-phone" inputmode="tel" maxlength="11" placeholder="01XXXXXXXXX"></label><button class="btn btn-outline btn-small" data-action="save-provider-phone"' + (preview || saving ? " disabled" : "") + '>حفظ الرقم</button></div>' +
    clinicLocationCard(provider, options.clinicDraft, preview || saving) +
    '<p class="notice">تظهر هنا الطلبات المسندة إلى حسابك فقط. تحديث الحالة يُسجل في سجل الطلب.</p>' +
    (preview ? '<p class="roadmap-lock-note">هذه نسخة معاينة للقراءة فقط؛ تحديث حالات الطلبات متوقف.</p>' : "") +
    (error ? '<p class="form-error">' + e(error) + '</p>' : "") +
    '<div class="stats-grid">' +
    '<div class="stat-card"><span>الطلبات المسندة النشطة</span><strong>' + assigned + '</strong></div>' +
    '<div class="stat-card"><span>الطلبات المكتملة</span><strong>' + completed + '</strong></div>' +
    '<div class="stat-card"><span>إجمالي المعروض</span><strong>' + orders.length + '</strong></div>' +
    '</div><section class="ops-section"><div class="section-heading"><div><span class="eyebrow">قائمة العمل</span><h2>طلباتي المسندة</h2></div></div>' +
    (orders.length ? '<div class="provider-order-list">' + cards + '</div>' : '<div class="empty-state"><strong>لا توجد طلبات مسندة إليك حاليًا</strong><p>ستظهر الطلبات هنا بعد إسنادها من فريق وصلة.</p></div>') +
    '</section></section>';
}
