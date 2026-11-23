import { escapeHTML, formatDate, formatEGP, sectorLabel, statusLabel } from "./domain.js";

const PRIORITY_LABELS = Object.freeze({ 1: "عاجل", 2: "متوسط", 3: "منخفض" });
const TICKET_STATUS_LABELS = Object.freeze({
  new: "جديدة",
  reviewing: "قيد المراجعة",
  processing: "قيد المعالجة",
  waiting_customer: "بانتظار العميل",
  resolved: "تم الحل",
  closed: "مغلقة"
});
const LEAD_STATUS_LABELS = Object.freeze({ new: "جديد", contacted: "تم التواصل", interested: "مهتم", follow_up: "متابعة", converted: "تحول لعميل", not_interested: "غير مهتم", unreachable: "تعذر الوصول" });
const TASK_KIND_LABELS = Object.freeze({
  call_customer: "اتصال بعميل",
  follow_order: "متابعة طلب",
  resolve_ticket: "حل تذكرة",
  reactivate_customer: "إعادة تنشيط عميل",
  follow_provider: "متابعة مقدم خدمة",
  follow_lead: "متابعة عميل محتمل",
  verify_data: "مراجعة بيانات",
  late_order: "طلب متأخر"
});

function e(value) {
  return escapeHTML(value == null ? "" : value);
}

function metric(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat("ar-EG").format(Number(value)) : "—";
}

function renderCustomerOptions(customers, selectedId) {
  return '<option value="">اختر العميل</option>' + customers.map(function (customer) {
    return '<option value="' + e(customer.id) + '" ' + (customer.id === selectedId ? "selected" : "") + '>' +
      e(customer.full_name || "عميل") + " · " + e(customer.phone || "") + "</option>";
  }).join("");
}

function renderLead(lead, canWrite) {
  return '<article class="crm-record">' +
    '<div class="crm-record-head"><div><strong>' + e(lead.full_name) + '</strong><small>' + e(lead.phone) + '</small></div>' +
    '<span class="crm-tag crm-priority-' + e(lead.priority) + '">' + e(PRIORITY_LABELS[lead.priority] || "متوسط") + "</span></div>" +
    '<p>' + e(lead.sector_interest || "اهتمام غير محدد") + " · " + e(lead.source || "manual") + "</p>" +
    '<div class="crm-record-foot"><span>' + e(LEAD_STATUS_LABELS[lead.status] || lead.status) + '</span><span>' +
    (lead.next_follow_up_at ? "المتابعة: " + e(formatDate(lead.next_follow_up_at)) : "لا يوجد موعد متابعة") + "</span></div>" +
    '<form class="crm-inline-form" data-form="crm-lead-update" data-lead-id="' + e(lead.id) + '">' +
    '<select name="status" aria-label="حالة العميل المحتمل">' +
    ["new","contacted","interested","follow_up","converted","not_interested","unreachable"].map(function (status) {
      return '<option value="' + status + '" ' + (lead.status === status ? "selected" : "") + ">" + (LEAD_STATUS_LABELS[status] || status) + "</option>";
    }).join("") +
    '</select><button class="btn btn-outline btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>حفظ الحالة</button></form></article>';
}

function renderTask(task, canWrite) {
  const completed = task.status === "done" || task.status === "cancelled";
  return '<article class="crm-record">' +
    '<div class="crm-record-head"><strong>' + e(task.title) + '</strong><span class="crm-tag">' +
    e(PRIORITY_LABELS[task.priority] || "متوسط") + "</span></div>" +
    '<p>' + e(TASK_KIND_LABELS[task.kind] || task.kind) + " · " + e(task.status) + "</p>" +
    '<div class="crm-record-foot"><span>' + (task.due_at ? "الاستحقاق: " + e(formatDate(task.due_at)) : "دون موعد") + "</span>" +
    (!completed ? '<button class="btn btn-outline btn-small" data-action="crm-task-done" data-task-id="' + e(task.id) + '">إنهاء المهمة</button>' : "<span>مغلقة</span>") +
    "</div></article>";
}

function renderTicket(ticket, canWrite) {
  return '<article class="crm-record">' +
    '<div class="crm-record-head"><div><strong>' + e(ticket.ref) + '</strong><small>' + e(ticket.kind) + "</small></div>" +
    '<span class="crm-tag crm-priority-' + e(ticket.priority) + '">' + e(PRIORITY_LABELS[ticket.priority] || "متوسط") + "</span></div>" +
    '<p>' + e(ticket.description) + "</p>" +
    '<div class="crm-record-foot"><span>' + e(TICKET_STATUS_LABELS[ticket.status] || ticket.status) + " · " + e(formatDate(ticket.opened_at)) + "</span></div>" +
    '<form class="crm-inline-form" data-form="crm-ticket-update" data-ticket-id="' + e(ticket.id) + '">' +
    '<select name="status" aria-label="حالة التذكرة">' +
    Object.keys(TICKET_STATUS_LABELS).map(function (status) {
      return '<option value="' + status + '" ' + (ticket.status === status ? "selected" : "") + ">" + TICKET_STATUS_LABELS[status] + "</option>";
    }).join("") +
    '</select><button class="btn btn-outline btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>تحديث</button></form></article>';
}

function renderCustomer360(data, canWrite) {
  if (!data || !data.profile) {
    return '<div class="empty-state"><strong>اختر عميلًا</strong><p>افتح ملف العميل لعرض سجل الطلبات والتذاكر والتواصل والمهام.</p></div>';
  }
  const profile = data.profile;
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const interactions = Array.isArray(data.interactions) ? data.interactions : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return '<div class="crm-customer-profile">' +
    '<div class="crm-record-head"><div><h3>' + e(profile.full_name) + '</h3><small>' + e(profile.phone) + '</small></div>' +
    '<span class="crm-tag">عميل منذ ' + e(formatDate(profile.created_at)) + "</span></div>" +
    '<div class="crm-subsection"><h4>سجل الطلبات (' + orders.length + ")</h4>" +
    (orders.length ? orders.map(function (order) {
      return '<div class="crm-timeline-row"><strong>' + e(order.ref) + " · " + e(sectorLabel(order.sector)) + '</strong><span>' +
        e(statusLabel(order.status)) + " · " + e(formatDate(order.created_at)) + " · " +
        (order.price_egp == null ? "السعر غير محدد" : e(formatEGP(order.price_egp))) + "</span></div>";
    }).join("") : '<p class="crm-muted">لا توجد طلبات.</p>') + "</div>" +
    '<div class="crm-subsection"><h4>التذاكر (' + tickets.length + ")</h4>" +
    (tickets.length ? tickets.map(function (ticket) {
      return '<div class="crm-timeline-row"><strong>' + e(ticket.ref) + " · " + e(ticket.kind) + '</strong><span>' +
        e(TICKET_STATUS_LABELS[ticket.status] || ticket.status) + " · " + e(formatDate(ticket.opened_at)) + "</span></div>";
    }).join("") : '<p class="crm-muted">لا توجد تذاكر.</p>') + "</div>" +
    '<div class="crm-subsection"><h4>التواصل والمتابعات (' + interactions.length + ")</h4>" +
    (interactions.length ? interactions.map(function (item) {
      return '<div class="crm-timeline-row"><strong>' + e(item.subject || item.kind) + '</strong><span>' +
        e(item.body || "") + " · " + e(formatDate(item.occurred_at)) + "</span></div>";
    }).join("") : '<p class="crm-muted">لا يوجد سجل تواصل.</p>') + "</div>" +
    '<div class="crm-subsection"><h4>المهام المفتوحة (' + tasks.length + ")</h4>" +
    (tasks.length ? tasks.map(function (task) {
      return '<div class="crm-timeline-row"><strong>' + e(task.title) + '</strong><span>' +
        e(task.status) + " · " + (task.due_at ? e(formatDate(task.due_at)) : "دون موعد") + "</span></div>";
    }).join("") : '<p class="crm-muted">لا توجد مهام مفتوحة.</p>') + "</div>" +
    '<form class="crm-form" data-form="crm-interaction" data-customer-id="' + e(profile.id) + '">' +
    '<h4>تسجيل تواصل جديد</h4><div class="crm-form-grid">' +
    '<label>نوع التواصل<select name="kind"><option value="call">مكالمة</option><option value="message">رسالة</option><option value="complaint">شكوى</option><option value="inquiry">استفسار</option><option value="note">ملاحظة</option><option value="follow_up">متابعة</option><option value="meeting">اجتماع</option></select></label>' +
    '<label>عنوان مختصر<input name="subject" maxlength="160" placeholder="سبب التواصل"></label></div>' +
    '<label>تفاصيل التواصل<textarea name="body" rows="2" maxlength="3000" placeholder="ملخص ما تم"></textarea></label>' +
    '<button class="btn btn-primary btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>حفظ التواصل</button></form></div>';
}

export function renderCrmView(options) {
  const profile = options.profile || null;
  if (!profile || !["staff", "admin"].includes(profile.role)) {
    return '<section class="page-panel"><h1>CRM وصلة</h1><div class="empty-state"><strong>غير مصرح</strong><p>هذه الوحدة متاحة لفريق التشغيل والإدارة فقط.</p></div></section>';
  }

  const metrics = options.metrics || {};
  const customers = Array.isArray(options.customers) ? options.customers : [];
  const leads = Array.isArray(options.leads) ? options.leads : [];
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const tickets = Array.isArray(options.tickets) ? options.tickets : [];
  const selectedId = options.selectedCustomerId || "";
  const canWrite = !options.preview && !options.saving;

  return '<section class="page-panel crm-page">' +
    '<div class="section-heading"><div><span class="eyebrow">إدارة علاقات العملاء</span><h1>CRM وصلة</h1></div>' +
    '<button class="btn btn-outline btn-small" data-action="reload-crm">تحديث البيانات</button></div>' +
    '<p class="notice">لوحة تشغيلية مبنية على بيانات وصلة الفعلية. الإيرادات المحصلة غير معروضة كرقم حتى يتوفر سجل مدفوعات موثوق.</p>' +
    (options.preview ? '<p class="roadmap-lock-note">نسخة المعاينة للقراءة فقط؛ عمليات الإضافة والتعديل متوقفة.</p>' : "") +
    (options.error ? '<p class="crm-error">' + e(options.error) + "</p>" : "") +
    '<div class="crm-metrics-grid">' +
    '<div class="stat-card"><span>إجمالي العملاء</span><strong>' + metric(metrics.total_customers) + "</strong></div>" +
    '<div class="stat-card"><span>نشطون آخر 30 يومًا</span><strong>' + metric(metrics.active_30d) + "</strong></div>" +
    '<div class="stat-card"><span>عملاء جدد هذا الشهر</span><strong>' + metric(metrics.new_month) + "</strong></div>" +
    '<div class="stat-card"><span>عملاء لم يطلبوا</span><strong>' + metric(metrics.never_ordered) + "</strong></div>" +
    '<div class="stat-card"><span>عملاء متكررون</span><strong>' + metric(metrics.repeat_customers) + "</strong></div>" +
    '<div class="stat-card"><span>إجمالي الطلبات</span><strong>' + metric(metrics.total_orders) + "</strong></div>" +
    '<div class="stat-card"><span>طلبات مفتوحة</span><strong>' + metric(metrics.open_orders) + "</strong></div>" +
    '<div class="stat-card"><span>تذاكر دعم مفتوحة</span><strong>' + metric(metrics.open_tickets) + "</strong></div>" +
    "</div>" +
    '<div class="crm-main-grid">' +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Customer CRM</span><h2>دليل العملاء</h2></div><span class="crm-count">' + customers.length + "</span></div>" +
    '<div class="crm-customer-list">' + (customers.length ? customers.map(function (customer) {
      return '<button class="crm-customer-row ' + (selectedId === customer.id ? "is-selected" : "") +
        '" data-action="crm-customer" data-customer-id="' + e(customer.id) + '"><strong>' + e(customer.full_name) +
        '</strong><span>' + e(customer.phone) + '</span><small>' + e(formatDate(customer.created_at)) + "</small></button>";
    }).join("") : '<p class="crm-muted">لا يوجد عملاء لعرضهم.</p>') + "</div></section>" +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Customer 360</span><h2>ملف العميل الموحد</h2></div>' +
    (selectedId ? '<button class="btn btn-outline btn-small" data-action="crm-back-customers">إغلاق الملف</button>' : "") + "</div>" +
    renderCustomer360(options.customer360, canWrite) + "</section></div>" +
    '<div class="crm-main-grid">' +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Lead Management</span><h2>العملاء المحتملون</h2></div><span class="crm-count">' + leads.length + "</span></div>" +
    '<form class="crm-form" data-form="crm-lead"><div class="crm-form-grid">' +
    '<label>الاسم<input name="full_name" required minlength="2" maxlength="120"></label>' +
    '<label>رقم الهاتف<input name="phone" required inputmode="tel" maxlength="30"></label>' +
    '<label>مصدر العميل<select name="source"><option value="manual">إدخال يدوي</option><option value="referral">ترشيح</option><option value="social">سوشيال ميديا</option><option value="campaign">حملة</option><option value="walkin">زيارة مباشرة</option></select></label>' +
    '<label>القطاع المهتم به<input name="sector_interest" maxlength="80" placeholder="مثال: صيانة"></label></div>' +
    '<button class="btn btn-primary btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>إضافة عميل محتمل</button></form>' +
    '<div class="crm-record-list">' + (leads.length ? leads.map(function (lead) { return renderLead(lead, canWrite); }).join("") : '<p class="crm-muted">لا توجد Leads مسجلة.</p>') + "</div></section>" +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Tasks & Follow-up</span><h2>المهام والمتابعات</h2></div><span class="crm-count">' + tasks.length + "</span></div>" +
    '<form class="crm-form" data-form="crm-task"><label>عنوان المهمة<input name="title" required maxlength="180"></label>' +
    '<div class="crm-form-grid"><label>نوع المهمة<select name="kind">' + Object.keys(TASK_KIND_LABELS).map(function (kind) {
      return '<option value="' + kind + '">' + TASK_KIND_LABELS[kind] + "</option>";
    }).join("") + '</select></label><label>العميل المرتبط<select name="customer_id">' + renderCustomerOptions(customers, selectedId) + "</select></label>" +
    '<label>الأولوية<select name="priority"><option value="1">عاجل</option><option value="2" selected>متوسط</option><option value="3">منخفض</option></select></label>' +
    '<label>موعد الاستحقاق<input name="due_at" type="datetime-local"></label></div>' +
    '<button class="btn btn-primary btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>إنشاء مهمة</button></form>' +
    '<div class="crm-record-list">' + (tasks.length ? tasks.map(function (task) { return renderTask(task, canWrite); }).join("") : '<p class="crm-muted">لا توجد مهام مفتوحة.</p>') + "</div></section></div>" +
    '<div class="crm-main-grid">' +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Support CRM</span><h2>الشكاوى والتذاكر</h2></div><span class="crm-count">' + tickets.length + "</span></div>" +
    '<form class="crm-form" data-form="crm-ticket"><div class="crm-form-grid"><label>العميل<select name="customer_id" required>' + renderCustomerOptions(customers, selectedId) + "</select></label>" +
    '<label>نوع التذكرة<select name="kind"><option value="complaint">شكوى</option><option value="inquiry">استفسار</option><option value="service_issue">مشكلة خدمة</option><option value="delay">تأخير</option><option value="billing">استفسار مالي</option></select></label>' +
    '<label>الأولوية<select name="priority"><option value="1">عاجل</option><option value="2" selected>متوسط</option><option value="3">منخفض</option></select></label></div>' +
    '<label>وصف التذكرة<textarea name="description" rows="2" minlength="5" maxlength="4000" required></textarea></label>' +
    '<button class="btn btn-primary btn-small" type="submit" ' + (canWrite ? "" : "disabled") + '>فتح تذكرة</button></form>' +
    '<div class="crm-record-list">' + (tickets.length ? tickets.map(function (ticket) { return renderTicket(ticket, canWrite); }).join("") : '<p class="crm-muted">لا توجد تذاكر دعم مسجلة.</p>') + "</div></section>" +
    '<section class="crm-panel"><div class="section-heading"><div><span class="eyebrow">Performance</span><h2>مؤشرات التشغيل</h2></div></div>' +
    '<div class="crm-summary-list"><div><span>طلبات جديدة</span><strong>' + metric(metrics.new_orders) + "</strong></div>" +
    '<div><span>طلبات مكتملة</span><strong>' + metric(metrics.completed_orders) + "</strong></div>" +
    '<div><span>طلبات ملغاة</span><strong>' + metric(metrics.cancelled_orders) + "</strong></div>" +
    '<div><span>الإيرادات المحصلة</span><strong>' + (metrics.collected_revenue_egp == null ? "غير متاح بعد" : e(formatEGP(metrics.collected_revenue_egp))) + "</strong></div></div>" +
    '<p class="crm-muted">معدل الاحتفاظ والتحويل وChurn يحتاجان تعريفًا زمنيًا ومصدر أحداث موثوقًا قبل نشر نسب إدارية.</p></section></div>' +
    "</section>";
}
