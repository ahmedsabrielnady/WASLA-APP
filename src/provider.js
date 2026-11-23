import { escapeHTML, formatDate, formatEGP, sectorLabel, statusLabel } from "./domain.js";

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

export function renderProviderView(options = {}) {
  const profile = options.profile || null;
  const provider = options.provider || null;
  const orders = Array.isArray(options.orders) ? options.orders : [];
  const preview = Boolean(options.preview);
  const saving = Boolean(options.saving);
  const error = String(options.error || "");

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
  const cards = orders.map((order) => {
    const action = order.status === "confirmed"
      ? ["in_progress", "بدء التنفيذ"]
      : order.status === "in_progress"
        ? ["done", "تأكيد إتمام الخدمة"]
        : null;
    const actionMarkup = action
      ? '<button class="btn btn-primary btn-small" data-action="provider-set-status" data-order-id="' + e(order.id) + '" data-status="' + action[0] + '"' + (preview || saving ? " disabled" : "") + '>' + action[1] + '</button>'
      : "";

    return '<article class="provider-order-card">' +
      '<div class="provider-order-head"><div><strong>' + e(order.ref || "طلب وصلة") + '</strong><small>' + e(sectorLabel(order.sector)) + '</small></div>' +
      '<span class="status-pill">' + e(statusLabel(order.status)) + '</span></div>' +
      '<div class="provider-order-meta">' +
      '<span>تاريخ الطلب: ' + e(formatDate(order.created_at)) + '</span>' +
      '<span>العنوان: ' + e(order.address || "لم يسجل عنوان") + '</span>' +
      '<span>السعر: ' + (order.price_egp == null ? "غير محدد" : e(formatEGP(order.price_egp))) + '</span>' +
      (order.scheduled_at ? '<span>الموعد: ' + e(formatDate(order.scheduled_at)) + '</span>' : "") +
      (order.notes ? '<span>ملاحظات العميل: ' + e(order.notes) + '</span>' : "") +
      '</div>' + (actionMarkup ? '<div class="provider-order-actions">' + actionMarkup + '</div>' : "") +
      '</article>';
  }).join("");

  return '<section class="page-panel provider-page">' +
    '<div class="section-heading"><div><span class="eyebrow">مساحة مقدم الخدمة</span><h1>أهلًا ' + e(provider.display_name) + '</h1>' +
    '<p class="provider-subtitle">' + e(KIND_LABELS[provider.kind] || "مقدم خدمة") + ' · ' + e(provider.specialty || provider.area || "وصلة") + '</p></div>' +
    '<button class="btn btn-outline btn-small" data-action="reload-provider">تحديث الطلبات</button></div>' +
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
