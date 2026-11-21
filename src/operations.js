import { escapeHTML, formatDate, formatEGP, sectorLabel, statusLabel } from "./domain.js";

const KIND_LABELS = Object.freeze({
  doctor: "طبيب",
  technician: "فني",
  teacher: "معلم",
  courier: "مندوب",
  merchant: "تاجر"
});

const SECTOR_PROVIDER_KINDS = Object.freeze({
  nursing: ["doctor", "technician"],
  maintenance: ["technician"],
  car: ["technician"],
  education: ["teacher"],
  delivery: ["courier"],
  food: ["merchant", "courier"]
});

function kindLabel(kind) {
  return KIND_LABELS[kind] || "مقدم خدمة";
}

function operationProviderName(providerId, providers) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return "غير معيّن";
  return provider.is_test
    ? `${provider.display_name} — تجريبي / لا يُستخدم للتعيين`
    : provider.display_name;
}

function renderOrderCard(order, providers, canWrite) {
  const transitions = ({
    new: [["confirmed", "تأكيد الطلب"], ["cancelled", "إلغاء"]],
    confirmed: [["in_progress", "بدء التنفيذ"], ["cancelled", "إلغاء"]],
    in_progress: [["done", "إنهاء الطلب"], ["cancelled", "إلغاء"]]
  })[order.status] || [];

  const statusActions = transitions.map(([nextStatus, label]) =>
    `<button class="btn ${nextStatus === "cancelled" ? "btn-danger-outline" : "btn-primary"} btn-small"
      data-action="ops-set-status"
      data-order-id="${escapeHTML(order.id)}"
      data-status="${nextStatus}"
      ${canWrite ? "" : "disabled"}>${label}</button>`
  ).join("");

  const compatibleKinds = SECTOR_PROVIDER_KINDS[order.sector] || [];
  const candidates = providers.filter((provider) =>
    provider.approved
    && provider.active
    && !provider.is_test
    && compatibleKinds.includes(provider.kind)
  );

  let assignment = "";
  if (compatibleKinds.length && candidates.length) {
    assignment = `
      <form class="ops-action-form" data-form="operations-assign" data-order-id="${escapeHTML(order.id)}">
        <label>مقدم الخدمة
          <select name="provider_id" required>
            <option value="">اختر مقدمًا معتمدًا</option>
            ${candidates.map((provider) => `
              <option value="${escapeHTML(provider.id)}" ${provider.id === order.provider_id ? "selected" : ""}>
                ${escapeHTML(provider.display_name)} — ${escapeHTML(kindLabel(provider.kind))}
              </option>
            `).join("")}
          </select>
        </label>
        <button class="btn btn-outline btn-small" type="submit" ${canWrite ? "" : "disabled"}>تعيين</button>
      </form>`;
  } else if (compatibleKinds.length) {
    assignment = '<p class="ops-muted">لا يوجد مقدم خدمة معتمد ومتوافق مع هذا القطاع حاليًا.</p>';
  } else if (order.sector === "clinic") {
    assignment = '<p class="ops-muted">الحجوزات الطبية لها مسار مستقل؛ لا يتم تعيينها من أداة الطلبات العامة.</p>';
  }

  const quote = order.status === "new" ? `
    <form class="ops-action-form" data-form="operations-quote" data-order-id="${escapeHTML(order.id)}">
      <label>عرض السعر بالجنيه
        <input name="price" type="number" min="0" max="10000000" step="1"
          value="${order.price_egp === null ? "" : Number(order.price_egp)}" required>
      </label>
      <button class="btn btn-outline btn-small" type="submit" ${canWrite ? "" : "disabled"}>إرسال عرض السعر</button>
    </form>` : "";

  const provider = operationProviderName(order.provider_id, providers);
  const address = order.sector === "clinic" ? "داخل العيادة" : (order.address || "لم يسجل عنوان");

  return `
    <article class="ops-order-card">
      <div class="ops-order-head">
        <div><strong>${escapeHTML(order.ref || "طلب")}</strong><p>${escapeHTML(sectorLabel(order.sector))}</p></div>
        <span class="status-pill">${escapeHTML(statusLabel(order.status))}</span>
      </div>
      <div class="ops-order-meta">
        <span>أُنشئ: ${escapeHTML(formatDate(order.created_at))}</span>
        <span>السعر: ${order.price_egp === null ? "غير محدد" : escapeHTML(formatEGP(order.price_egp))}</span>
        <span>العربون: ${Number(order.deposit_egp) > 0 ? escapeHTML(formatEGP(order.deposit_egp)) : "لا يوجد"}</span>
        ${order.scheduled_at ? `<span>الموعد: ${escapeHTML(formatDate(order.scheduled_at))}</span>` : ""}
        <span>العنوان: ${escapeHTML(address)}</span>
        <span>مقدم الخدمة: ${escapeHTML(provider)}</span>
      </div>
      <div class="ops-action-area">
        ${statusActions}
        ${quote}
        ${assignment}
      </div>
    </article>
  `;
}

function renderPendingProvider(provider, canWrite) {
  return `
    <article class="ops-provider-card">
      <div><strong>${escapeHTML(provider.display_name)}</strong>
        <span>${escapeHTML(kindLabel(provider.kind))}</span>
        <small>${escapeHTML(provider.specialty || provider.area || "بيانات مهنية لم تكتمل")}</small>
      </div>
      <button class="btn btn-primary btn-small"
        data-action="approve-provider"
        data-provider-id="${escapeHTML(provider.id)}"
        ${canWrite ? "" : "disabled"}>اعتماد مقدم الخدمة</button>
    </article>`;
}

export function renderOperationsView(options = {}) {
  const profile = options.profile || null;
  const orders = Array.isArray(options.orders) ? options.orders : [];
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const preview = Boolean(options.preview);
  const saving = Boolean(options.saving);
  const role = profile?.role;

  if (!["staff", "admin"].includes(role)) {
    return '<section class="page-panel"><h1>لوحة التشغيل</h1><div class="empty-state"><strong>غير مصرح</strong><p>هذه الصفحة مخصصة للموظفين والإدارة المعتمدة.</p></div></section>';
  }

  const activeCount = orders.filter((order) => !["done", "cancelled"].includes(order.status)).length;
  const completedCount = orders.filter((order) => order.status === "done").length;
  const pendingProviders = providers.filter((provider) =>
    !provider.approved && provider.active && !provider.is_test
  );
  const canWrite = !preview && !saving;

  return `
    <section class="page-panel operations-page">
      <div class="section-heading">
        <div><span class="eyebrow">${role === "admin" ? "إدارة المؤسس" : "إدارة الموظف"}</span><h1>لوحة التشغيل</h1></div>
        <button class="btn btn-outline btn-small" data-action="reload-operations">تحديث</button>
      </div>
      <p class="notice">تُنفذ تغييرات الطلبات والاعتماد عبر دوال قاعدة البيانات، وتُسجل الأحداث. صلاحيات الموظف والمؤسس تُفرض في PostgreSQL.</p>
      <div class="stats-grid">
        <div class="stat-card"><span>الطلبات المعروضة</span><strong>${orders.length}</strong></div>
        <div class="stat-card"><span>قيد التنفيذ</span><strong>${activeCount}</strong></div>
        <div class="stat-card"><span>مكتملة</span><strong>${completedCount}</strong></div>
        <div class="stat-card"><span>طلبات اعتماد جديدة</span><strong>${pendingProviders.length}</strong></div>
      </div>
      ${preview ? '<p class="roadmap-lock-note">هذه نسخة معاينة للقراءة فقط. أدوات تغيير الحالات والأسعار والتعيين والاعتماد متوقفة لحماية قاعدة الإنتاج.</p>' : ""}
      <section class="ops-section">
        <div class="section-heading"><div><span class="eyebrow">مراجعة مقدمي الخدمة</span><h2>طلبات الانضمام</h2></div></div>
        ${pendingProviders.length
          ? `<div class="ops-provider-list">${pendingProviders.map((provider) => renderPendingProvider(provider, canWrite)).join("")}</div>`
          : '<p class="ops-muted">لا توجد طلبات انضمام تنتظر الاعتماد.</p>'}
      </section>
      <section class="ops-section">
        <div class="section-heading"><div><span class="eyebrow">إدارة الطلبات</span><h2>الطلبات الواردة</h2></div></div>
        ${orders.length
          ? `<div class="ops-order-list">${orders.map((order) => renderOrderCard(order, providers, canWrite)).join("")}</div>`
          : '<div class="empty-state"><strong>لا توجد طلبات</strong><p>ستظهر الطلبات هنا عند وصولها.</p></div>'}
      </section>
    </section>
  `;
}
