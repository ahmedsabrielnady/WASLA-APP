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
    && (order.sector !== "nursing" || provider.nursing_credential_verified === true)
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
  } else if (order.sector === "nursing" && compatibleKinds.length) {
    assignment = '<p class="ops-muted">لا يوجد مقدم خدمة معتمد للتمريض. اعتمد بيانات التمريض من قسم اعتماد التمريض أولًا.</p>';
  } else if (compatibleKinds.length) {
    assignment = '<p class="ops-muted">لا يوجد مقدم خدمة معتمد ومتوافق مع هذا القطاع حاليًا.</p>';
  } else if (order.sector === "clinic") {
    assignment = '<p class="ops-muted">الحجوزات الطبية لها مسار مستقل؛ لا يتم تعيينها من أداة الطلبات العامة.</p>';
  }

  const schedulable = order.sector === "nursing" && ["new", "confirmed"].includes(order.status);
  const schedule = schedulable ? `
    ${order.preferred_at ? `<p class="ops-muted">الموعد المقترح من المريض: ${escapeHTML(formatCairoTime(order.preferred_at))} (مقترح فقط)</p>` : '<p class="ops-muted">المريض لم يقترح موعدًا.</p>'}
    <form class="ops-action-form" data-form="operations-schedule" data-order-id="${escapeHTML(order.id)}">
      <label>الموعد المؤكد (بتوقيت القاهرة)
        <input name="scheduled_at" type="datetime-local" required>
      </label>
      <button class="btn btn-outline btn-small" type="submit" ${canWrite ? "" : "disabled"}>تحديد الموعد المؤكد</button>
    </form>` : "";

  const quote = ["new", "quoted"].includes(order.status) ? `
    ${order.status === "quoted" && order.quote_price_egp != null ? `<p class="ops-muted">عرض السعر المرسل: ${escapeHTML(Number(order.quote_price_egp))} ج.م. بانتظار موافقة العميل.</p>` : ""}
    <form class="ops-action-form" data-form="operations-quote" data-order-id="${escapeHTML(order.id)}">
      <label>عرض السعر بالجنيه
        <input name="price" type="number" min="0" max="10000000" step="1"
          value="${order.status === "quoted" && order.quote_price_egp != null ? Number(order.quote_price_egp) : (order.price_egp === null ? "" : Number(order.price_egp))}" required>
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
        ${order.scheduled_at ? `<span>الموعد المؤكد: ${escapeHTML(formatCairoTime(order.scheduled_at))}</span>` : ""}
        <span>العنوان: ${escapeHTML(address)}</span>
        <span>مقدم الخدمة: ${escapeHTML(provider)}</span>
      </div>
      <div class="ops-action-area">
        ${statusActions}
        ${quote}
        ${assignment}
        ${schedule}
      </div>
    </article>
  `;
}

function formatCairoTime(value) {
  try {
    return new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch { return "غير محدد"; }
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

function renderChangeRequests(requests, orders, canWrite) {
  const open = requests.filter((r) => r.status === "open");
  if (!open.length) return "";
  const byId = new Map(orders.map((o) => [o.id, o]));
  const kind = { change_time: "تغيير الموعد", cancel: "إلغاء الزيارة" };
  return `
    <section class="ops-section" id="order-change-requests">
      <div class="section-heading"><div><span class="eyebrow">تمريض</span><h2>طلبات تعديل أو إلغاء بعد التأكيد</h2></div></div>
      <p class="ops-muted">الطلب مجرد طلب من العميل. "تم التنفيذ" بتتقبل بس لو الزيارة اتلغت فعلًا أو الموعد اتغير فعلًا. غير كده اختار "مراجعة بدون تغيير".</p>
      ${open.map((r) => { const ord = byId.get(r.order_id); return `
        <article class="ops-provider-card">
          <div><strong>${escapeHTML(ord?.ref || "طلب")}</strong> <span>${escapeHTML(kind[r.kind] || r.kind)} (طلب فقط)</span>
            ${r.note ? `<small>ملاحظة العميل: ${escapeHTML(r.note)}</small>` : ""}
          </div>
          <div class="order-card-actions">
            <button class="btn btn-primary btn-small" data-action="ops-resolve-change" data-request-id="${escapeHTML(r.id)}" data-status="applied" ${canWrite ? "" : "disabled"}>تم التنفيذ</button>
            <button class="btn btn-outline btn-small" data-action="ops-resolve-change" data-request-id="${escapeHTML(r.id)}" data-status="declined" ${canWrite ? "" : "disabled"}>مراجعة بدون تغيير</button>
          </div>
        </article>`; }).join("")}
    </section>`;
}

function renderNursingCredentialManager(providers, canWrite) {
  const list = providers.filter((p) => ["doctor", "technician"].includes(p.kind) && p.approved && p.active && !p.is_test);
  return `
    <section class="ops-section" id="nursing-credentials">
      <div class="section-heading"><div><span class="eyebrow">التمريض المنزلي</span><h2>اعتماد التمريض</h2></div></div>
      <p class="ops-muted">لا يُسند طلب تمريض إلا لمقدم خدمة اعتمدته السكرتارية هنا بعد مراجعة الترخيص خارج النظام. دور الطبيب أو الفني وحده لا يكفي.</p>
      ${list.length ? `<div class="ops-order-list">${list.map((p) => `
        <article class="ops-order-card">
          <div class="ops-order-main">
            <strong>${escapeHTML(p.display_name)}</strong>
            <span>${escapeHTML(kindLabel(p.kind))}</span>
            <span class="status-pill">${p.nursing_credential_verified ? "معتمد للتمريض" : "غير معتمد للتمريض"}</span>
          </div>
          <button class="btn btn-outline btn-small" type="button" data-action="set-nursing-credential" data-provider-id="${escapeHTML(p.id)}" data-verified="${p.nursing_credential_verified ? "no" : "yes"}" ${canWrite ? "" : "disabled"}>${p.nursing_credential_verified ? "سحب الاعتماد" : "اعتماد للتمريض"}</button>
        </article>`).join("")}</div>` : '<p class="ops-muted">لا يوجد طبيب أو فني معتمد ونشط.</p>'}
    </section>`;
}

function renderServicePriceManager(services, canWrite) {
  if (!services.length) {
    return '<p class="ops-muted">تعذر تحميل قائمة الخدمات أو لا توجد عناصر مسجلة.</p>';
  }

  return `
    <div class="ops-order-list ops-service-price-list">
      ${services.map((service) => `
        <form class="ops-action-form ops-service-price-form" data-form="operations-service-price" data-item-id="${escapeHTML(service.id)}">
          <div class="ops-service-price-info">
            <strong>${escapeHTML(service.name)}</strong>
            <small>${escapeHTML(sectorLabel(service.sector))}</small>
            <span class="status-pill">${service.public_orderable ? "مسموح بالطلب" : "غير متاح للطلب"}</span>
            <span class="ops-muted">${service.active ? "نشطة في الكتالوج" : "مخفية من الكتالوج"}</span>
          </div>
          <label>السعر بالجنيه
            <input name="price" type="number" min="0" max="10000000" step="1"
              value="${service.price_egp === null ? "" : Number(service.price_egp)}"
              placeholder="بعد المعاينة">
          </label>
          <button class="btn btn-outline btn-small" type="submit" ${canWrite ? "" : "disabled"}>حفظ السعر</button>
        </form>
      `).join("")}
    </div>
  `;
}

function renderProviderInviteManager(latestInviteCode, canWrite) {
  return `
    <section class="ops-section">
      <div class="section-heading"><div><span class="eyebrow">توسيع شبكة وصلة</span><h2>دعوات مقدمي الخدمة</h2></div></div>
      <p class="ops-muted">أنشئ دعوة لمقدم خدمة تمت مراجعته مبدئيًا. لا يصبح الحساب معتمدًا أو قابلًا لاستقبال الطلبات إلا بعد مراجعة الإدارة.</p>
      <form class="ops-action-form" data-form="operations-invite">
        <label>نوع مقدم الخدمة
          <select name="kind" required>
            <option value="technician">فني صيانة</option>
            <option value="doctor">طبيب</option>
            <option value="merchant">تاجر / متجر</option>
            <option value="courier">مندوب توصيل</option>
            <option value="teacher">مدرس</option>
          </select>
        </label>
        <button class="btn btn-primary btn-small" type="submit" ${canWrite ? "" : "disabled"}>إنشاء كود دعوة</button>
      </form>
      ${latestInviteCode ? `
        <div class="invite-code-panel">
          <span>كود الدعوة الجديد</span>
          <strong dir="ltr">${escapeHTML(latestInviteCode)}</strong>
          <button class="btn btn-outline btn-small" type="button" data-action="copy-invite" ${canWrite ? "" : "disabled"}>نسخ الكود</button>
        </div>
      ` : ""}
    </section>
  `;
}

function renderProviderCoverageManager(providers, services, coverage, canWrite) {
  const eligibleProviders = providers.filter((provider) =>
    provider.approved && provider.active && !provider.is_test
  );
  const activeServices = services.filter((service) => service.active);
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const serviceById = new Map(services.map((service) => [service.id, service]));

  return `
    <section class="ops-section">
      <div class="section-heading"><div><span class="eyebrow">ضبط التغطية التشغيلية</span><h2>ربط مقدم الخدمة بالخدمات</h2></div></div>
      <p class="ops-muted">اربط مقدمًا معتمدًا بخدمة بعد التحقق من تخصصه وقدرته على تنفيذها. التغطية النشطة هي التي تسمح بظهور الخدمة للطلب، والإسناد يتحقق من نفس الربط.</p>
      ${eligibleProviders.length && activeServices.length ? `
        <form class="ops-action-form" data-form="operations-provider-coverage">
          <label>مقدم الخدمة
            <select name="provider_id" required>
              <option value="">اختر مقدم الخدمة</option>
              ${eligibleProviders.map((provider) => `<option value="${escapeHTML(provider.id)}">${escapeHTML(provider.display_name)} — ${escapeHTML(provider.specialty || provider.kind)}</option>`).join("")}
            </select>
          </label>
          <label>الخدمة
            <select name="service_item_id" required>
              <option value="">اختر الخدمة</option>
              ${activeServices.map((service) => `<option value="${escapeHTML(service.id)}">${escapeHTML(sectorLabel(service.sector))} — ${escapeHTML(service.name)}</option>`).join("")}
            </select>
          </label>
          <button class="btn btn-primary btn-small" type="submit" ${canWrite ? "" : "disabled"}>اعتماد التغطية</button>
        </form>
      ` : '<p class="ops-muted">لا يوجد حاليًا مقدم خدمة معتمد ونشط يمكن ربطه بالخدمات.</p>'}
      <div class="ops-order-list">
        ${coverage.length ? coverage.map((entry) => {
          const provider = providerById.get(entry.provider_id);
          const service = serviceById.get(entry.service_item_id);
          if (!provider || !service) return "";
          return `
            <article class="ops-order-card">
              <div class="ops-order-main">
                <strong>${escapeHTML(service.name)}</strong>
                <span>${escapeHTML(provider.display_name)} — ${escapeHTML(provider.specialty || provider.kind)}</span>
                <span class="status-pill">${entry.active ? (service.public_orderable ? "مغطاة وقابلة للطلب" : "مغطاة — القطاع غير مفتوح") : "تغطية موقوفة"}</span>
              </div>
              ${entry.active ? `<button class="btn btn-outline btn-small" type="button" data-action="disable-provider-coverage" data-provider-id="${escapeHTML(entry.provider_id)}" data-service-id="${escapeHTML(entry.service_item_id)}" ${canWrite ? "" : "disabled"}>إيقاف التغطية</button>` : ""}
            </article>
          `;
        }).join("") : '<p class="ops-muted">لا توجد روابط تغطية مسجلة حتى الآن.</p>'}
      </div>
    </section>
  `;
}

export function renderOperationsView(options = {}) {
  const profile = options.profile || null;
  const orders = Array.isArray(options.orders) ? options.orders : [];
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const services = Array.isArray(options.services) ? options.services : [];
  const latestInviteCode = String(options.latestInviteCode || "");
  const coverage = Array.isArray(options.coverage) ? options.coverage : [];
  const changeRequests = Array.isArray(options.changeRequests) ? options.changeRequests : [];
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
      ${role === "admin" ? `
        <section class="ops-section">
          <div class="section-heading"><div><span class="eyebrow">إدارة الكتالوج</span><h2>أسعار الخدمات</h2></div></div>
          <p class="ops-muted">يمكن للمؤسس تعديل السعر أو تركه فارغًا للتسعير بعد المعاينة. تعديل السعر لا يفعّل الطلب؛ الإتاحة مرتبطة بتغطية مقدم خدمة معتمد.</p>
          ${renderServicePriceManager(services, canWrite)}
        </section>
      ` : ""}
      ${role === "admin" ? renderProviderCoverageManager(providers, services, coverage, canWrite) : ""}
      ${renderChangeRequests(changeRequests, orders, canWrite)}
      ${renderNursingCredentialManager(providers, canWrite)}
      ${renderProviderInviteManager(latestInviteCode, canWrite)}
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
