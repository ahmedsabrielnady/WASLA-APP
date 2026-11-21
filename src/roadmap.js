import { calculateRoadmapMetrics, escapeHTML, formatDate } from "./domain.js";

const STATUS_LABELS = {
  planned: "لم يبدأ",
  in_progress: "قيد التنفيذ",
  blocked: "متوقف",
  done: "مكتمل"
};

const TEST_LABELS = {
  not_tested: "لم يُختبر",
  passed: "اجتاز الاختبار",
  failed: "فشل الاختبار"
};

function progressBar(value, label) {
  const percent = Math.min(100, Math.max(0, Number(value) || 0));
  return '<div class="roadmap-progress-track" role="progressbar" aria-label="' +
    escapeHTML(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
    percent + '"><span style="width:' + percent + '%"></span></div>';
}

export function renderRoadmapHome(items, error) {
  if (error) {
    return '<section class="roadmap-home-card"><div><span class="eyebrow">متابعة بناء وصلة</span>' +
      '<h2>خطة الإنجاز</h2></div><p class="roadmap-muted">' +
      escapeHTML(error) + '</p><button class="btn btn-outline btn-small" data-action="reload-roadmap">' +
      'إعادة تحميل الخطة</button></section>';
  }

  const metrics = calculateRoadmapMetrics(items);
  return '<section class="roadmap-home-card">' +
    '<div class="roadmap-home-head"><div><span class="eyebrow">متابعة التنفيذ بشفافية</span>' +
    '<h2>إلى أين وصلت وصلة؟</h2></div><strong class="roadmap-home-percent">' +
    metrics.weightedProgress + '%</strong></div>' +
    progressBar(metrics.weightedProgress, "إنجاز خطة وصلة") +
    '<div class="roadmap-home-meta"><span>' + metrics.doneCount +
    ' بند مكتمل ومختبر</span><span>' + Math.max(0, metrics.milestoneCount - metrics.doneCount) +
    ' بند متبقٍ أو قيد التنفيذ</span></div>' +
    '<button class="btn btn-outline btn-small" data-action="roadmap">عرض الخطة ونسب كل بند</button>' +
    '</section>';
}

function milestoneEditor(item, profile, preview, savingId) {
  if (profile?.role !== "admin") return "";
  if (preview) {
    return '<p class="roadmap-lock-note">التعديل مقفل في رابط المعاينة لحماية بيانات الإنتاج.</p>';
  }

  const statusOptions = Object.keys(STATUS_LABELS).map(function(value) {
    return '<option value="' + value + '"' + (item.status === value ? " selected" : "") + '>' +
      STATUS_LABELS[value] + '</option>';
  }).join("");

  const testOptions = Object.keys(TEST_LABELS).map(function(value) {
    return '<option value="' + value + '"' + (item.test_status === value ? " selected" : "") + '>' +
      TEST_LABELS[value] + '</option>';
  }).join("");

  return '<form class="roadmap-edit-form" data-form="roadmap-milestone" data-milestone-id="' +
    escapeHTML(item.id) + '">' +
    '<label>حالة التنفيذ<select name="status">' + statusOptions + '</select></label>' +
    '<label>نسبة البند<input name="progress_percent" type="number" min="0" max="100" step="5" value="' +
    Number(item.progress_percent) + '" required></label>' +
    '<label>نتيجة الاختبار<select name="test_status">' + testOptions + '</select></label>' +
    '<button class="btn btn-primary btn-small" type="submit"' +
    (savingId === item.id ? " disabled" : "") + '>' +
    (savingId === item.id ? "جارٍ الحفظ..." : "حفظ التحديث") + '</button>' +
    '<p class="roadmap-edit-hint">لا يمكن اعتماد بند مكتمل إلا عند 100% ونجاح الاختبار.</p>' +
    '</form>';
}

function milestoneCard(item, profile, preview, savingId) {
  const progress = Math.min(100, Math.max(0, Number(item.progress_percent) || 0));
  const status = STATUS_LABELS[item.status] || "حالة غير معروفة";
  const testStatus = TEST_LABELS[item.test_status] || "حالة اختبار غير معروفة";

  return '<article class="roadmap-item-card">' +
    '<div class="roadmap-item-top"><div><span class="roadmap-weight">وزن ' +
    Number(item.weight) + ' نقاط</span><h3>' + escapeHTML(item.title) + '</h3></div>' +
    '<span class="roadmap-status roadmap-status-' + escapeHTML(item.status) + '">' +
    escapeHTML(status) + '</span></div>' +
    '<p class="roadmap-item-description">' + escapeHTML(item.description) + '</p>' +
    '<div class="roadmap-item-progress-head"><span>' + progress + '% من البند</span>' +
    '<span class="roadmap-test roadmap-test-' + escapeHTML(item.test_status) + '">' +
    escapeHTML(testStatus) + '</span></div>' +
    progressBar(progress, "إنجاز " + item.title) +
    milestoneEditor(item, profile, preview, savingId) +
    '</article>';
}

function auditView(audit) {
  if (!Array.isArray(audit) || !audit.length) {
    return '<p class="roadmap-muted">لا توجد تغييرات مسجلة على الخطة حتى الآن.</p>';
  }

  return '<section class="roadmap-audit"><div class="section-heading"><div>' +
    '<span class="eyebrow">سجل التعديلات</span><h2>آخر تحديثات الخطة</h2></div></div>' +
    '<div class="roadmap-audit-list">' + audit.map(function(entry) {
      const status = STATUS_LABELS[entry.new_status] || entry.new_status;
      return '<article class="roadmap-audit-row"><strong>' +
        escapeHTML(entry.milestone_title_snapshot) + '</strong><span>' +
        escapeHTML(status) + ' · ' + Number(entry.new_progress_percent) + '%</span><time>' +
        escapeHTML(formatDate(entry.created_at)) + '</time></article>';
    }).join("") + '</div></section>';
}

export function renderRoadmapPage(options) {
  const items = Array.isArray(options.items) ? options.items : [];
  const profile = options.profile || null;
  const preview = Boolean(options.preview);
  const audit = options.audit || [];
  const savingId = options.savingId || "";
  const error = options.error || "";

  if (error) {
    return '<section class="page-panel"><div class="section-heading"><div>' +
      '<span class="eyebrow">خطة وصلة</span><h1>خارطة الإنجاز</h1></div>' +
      '<button class="btn btn-outline btn-small" data-action="reload-roadmap">إعادة المحاولة</button>' +
      '</div><div class="empty-state"><strong>تعذر تحميل الخطة</strong><p>' +
      escapeHTML(error) + '</p></div></section>';
  }

  const metrics = calculateRoadmapMetrics(items);
  const groups = new Map();
  items.forEach(function(item) {
    const area = item.area || "أعمال أخرى";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(item);
  });

  const groupMarkup = Array.from(groups.entries()).map(function(entry) {
    const area = entry[0];
    const groupItems = entry[1];
    const groupMetrics = calculateRoadmapMetrics(groupItems);
    return '<section class="roadmap-group"><div class="roadmap-group-head"><div>' +
      '<span class="eyebrow">' + groupItems.length + ' بنود</span><h2>' +
      escapeHTML(area) + '</h2></div><strong>' + groupMetrics.weightedProgress +
      '%</strong></div>' + progressBar(groupMetrics.weightedProgress, "إنجاز " + area) +
      '<div class="roadmap-items-list">' + groupItems.map(function(item) {
        return milestoneCard(item, profile, preview, savingId);
      }).join("") + '</div></section>';
  }).join("");

  const accessNotice = profile?.role === "admin"
    ? (preview
      ? '<div class="roadmap-lock-note">وضع المعاينة للقراءة فقط؛ التعديل متوقف لحماية قاعدة الإنتاج.</div>'
      : '<div class="roadmap-admin-note">وضع المؤسس: يمكنك تحديث نسبة كل بند وحالة اختباره. كل تغيير يُحفظ في سجل تدقيق.</div>')
    : '<div class="roadmap-lock-note">الخطة متاحة للقراءة. تعديل نسب الإنجاز محصور بحساب المؤسس admin.</div>';

  return '<section class="page-panel roadmap-page">' +
    '<div class="section-heading"><div><span class="eyebrow">متابعة بناء المنصة</span>' +
    '<h1>خارطة إنجاز وصلة</h1></div><button class="btn btn-outline btn-small" data-action="reload-roadmap">تحديث</button></div>' +
    '<p class="roadmap-intro">هذه قائمة العمل الكاملة، وليست عدًّا شكليًا للميزات. لكل بند وزن يعكس حجمه ونسبة تنفيذه ونتيجة اختباره. تتغير النسبة العامة تلقائيًا عندما يحدّث المؤسس حالة بند ويثبت اختباره.</p>' +
    '<div class="roadmap-overall"><div class="roadmap-overall-head"><div><span class="eyebrow">الإنجاز الموزون</span>' +
    '<h2>تقدم خطة وصلة</h2></div><strong>' + metrics.weightedProgress + '%</strong></div>' +
    progressBar(metrics.weightedProgress, "نسبة الإنجاز الموزونة") +
    '<div class="roadmap-overall-stats">' +
    '<div><strong>' + metrics.doneCount + '</strong><span>مكتمل ومختبر</span></div>' +
    '<div><strong>' + metrics.inProgressCount + '</strong><span>قيد التنفيذ</span></div>' +
    '<div><strong>' + metrics.blockedCount + '</strong><span>متوقف على متطلب</span></div>' +
    '<div><strong>' + metrics.plannedCount + '</strong><span>لم يبدأ</span></div>' +
    '</div><div class="roadmap-quality">' +
    '<div><span>وزن البنود التي اجتازت الاختبار</span><strong>' + metrics.passedTestProgress + '%</strong></div>' +
    progressBar(metrics.passedTestProgress, "وزن البنود التي اجتازت الاختبار") +
    '<div><span>إنجاز مكتمل ومثبت بالاختبار</span><strong>' + metrics.verifiedCompletion + '%</strong></div>' +
    progressBar(metrics.verifiedCompletion, "إنجاز مكتمل ومثبت بالاختبار") +
    '</div></div>' +
    '<div class="roadmap-method"><strong>طريقة الحساب:</strong> مجموع (وزن كل بند × نسبة تنفيذه) ÷ مجموع أوزان البنود. لا يحصل بند «مكتمل» على 100% إلا إذا كانت نتيجة اختباره «اجتاز الاختبار». النسبة تقدير تنفيذي من حالة البنود الحالية وليست شهادة جاهزية للإطلاق.</div>' +
    accessNotice +
    '<div class="roadmap-groups">' + groupMarkup + '</div>' +
    (profile?.role === "admin" && !preview ? auditView(audit) : "") +
    '</section>';
}
