export const SECTORS = Object.freeze([
  { code: "clinic", title: "العيادات", icon: "🩺", description: "حجز كشف ومتابعة طبية", mode: "review" },
  { code: "nursing", title: "التمريض المنزلي", icon: "🧑‍⚕️", description: "يُتاح بعد استكمال متطلبات الخصوصية والبيانات الصحية", mode: "review" },
  { code: "food", title: "المطاعم", icon: "🍽️", description: "مطاعم وأكلات محلية", mode: "soon" },
  { code: "market", title: "الماركت", icon: "🛒", description: "احتياجات البيت والبقالة", mode: "soon" },
  { code: "maintenance", title: "الصيانة المنزلية", icon: "🧰", description: "سباكة وكهرباء وخدمات منزلية", mode: "order" },
  { code: "education", title: "التعليم", icon: "📚", description: "مدرسون ومتابعة تعليمية", mode: "soon" },
  { code: "car", title: "خدمات السيارات", icon: "🚗", description: "غسيل وبطارية وخدمات للسيارة", mode: "order" },
  { code: "delivery", title: "التوصيل", icon: "🚚", description: "توصيل الطلبات وتتبعها", mode: "review" }
]);

export const ORDERABLE_SECTORS = new Set(["maintenance", "car"]);

export const STATUS_LABELS = Object.freeze({
  new: "طلب جديد",
  quoted: "بانتظار موافقتك على السعر",
  confirmed: "تم التأكيد",
  in_progress: "جارٍ التنفيذ",
  done: "مكتمل",
  cancelled: "ملغي",
  pending: "قيد المراجعة",
  accepted: "مقبول",
  preparing: "قيد التجهيز",
  assigned: "تم تعيين مقدم الخدمة",
  delivered: "تم التسليم"
});

export function canRequestService(service) {
  return Boolean(service && ORDERABLE_SECTORS.has(service.sector));
}

/** Keep the public "available now" catalogue limited to services whose order flow is enabled. */
export function filterOrderableServices(services) {
  return Array.isArray(services) ? services.filter((service) => canRequestService(service) && service.public_orderable === true) : [];
}

export function isEgyptianPhone(value) {
  return /^01[0125][0-9]{8}$/.test(String(value ?? "").trim());
}

export function isValidAddress(value) {
  const address = String(value ?? "").trim();
  return address.length >= 4 && address.length <= 255;
}

export function isValidCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

export function formatEGP(value) {
  if (value === null || value === undefined || value === "") {
    return "يتحدد بعد المعاينة";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "السعر غير محدد";
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(value) {
  if (!value) return "لم يحدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "لم يحدد";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function statusLabel(value) {
  return STATUS_LABELS[value] ?? "حالة غير معروفة";
}

export function sectorLabel(value) {
  return SECTORS.find((sector) => sector.code === value)?.title ?? "خدمة وصلة";
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}


export function calculateRoadmapMetrics(items) {
  const rows = Array.isArray(items) ? items : [];
  const valid = rows.filter((item) => {
    const weight = Number(item?.weight);
    const progress = Number(item?.progress_percent);
    return Number.isFinite(weight) && weight > 0
      && Number.isFinite(progress) && progress >= 0 && progress <= 100;
  });

  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  if (totalWeight === 0) {
    return {
      milestoneCount: valid.length,
      totalWeight: 0,
      weightedProgress: 0,
      testedProgress: 0,
      verifiedCompletion: 0,
      doneCount: 0,
      blockedCount: 0,
      plannedCount: 0,
      inProgressCount: 0
    };
  }

  const weightedPoints = valid.reduce(
    (sum, item) => sum + Number(item.weight) * Number(item.progress_percent),
    0
  );
  const testedWeight = valid.reduce(
    (sum, item) => sum + (["passed", "failed"].includes(item.test_status) ? Number(item.weight) : 0),
    0
  );
  const passedWeight = valid.reduce(
    (sum, item) => sum + (item.test_status === "passed" ? Number(item.weight) : 0),
    0
  );
  const verifiedWeight = valid.reduce(
    (sum, item) => sum + (
      item.status === "done"
      && item.test_status === "passed"
      && Number(item.progress_percent) === 100
        ? Number(item.weight)
        : 0
    ),
    0
  );

  return {
    milestoneCount: valid.length,
    totalWeight,
    weightedProgress: Math.round(weightedPoints / totalWeight * 10) / 10,
    testedProgress: Math.round(testedWeight / totalWeight * 1000) / 10,
    passedTestProgress: Math.round(passedWeight / totalWeight * 1000) / 10,
    verifiedCompletion: Math.round(verifiedWeight / totalWeight * 1000) / 10,
    doneCount: valid.filter((item) => item.status === "done" && item.test_status === "passed").length,
    blockedCount: valid.filter((item) => item.status === "blocked").length,
    plannedCount: valid.filter((item) => item.status === "planned").length,
    inProgressCount: valid.filter((item) => item.status === "in_progress").length
  };
}

export function validateRoadmapUpdate(status, progressPercent, testStatus) {
  const progress = Number(progressPercent);
  const allowedStatuses = new Set(["planned", "in_progress", "blocked", "done"]);
  const allowedTests = new Set(["not_tested", "passed", "failed"]);

  if (!allowedStatuses.has(status)) {
    return { valid: false, message: "حالة التنفيذ غير معروفة." };
  }
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return { valid: false, message: "نسبة البند يجب أن تكون رقمًا صحيحًا من 0 إلى 100." };
  }
  if (!allowedTests.has(testStatus)) {
    return { valid: false, message: "حالة الاختبار غير معروفة." };
  }
  if (status === "planned" && progress !== 0) {
    return { valid: false, message: "البند المخطط لم يبدأ يجب أن تكون نسبته صفرًا." };
  }
  if (status === "done" && (progress !== 100 || testStatus !== "passed")) {
    return { valid: false, message: "لا يمكن اعتماد بند مكتمل قبل وصوله إلى 100% واجتياز اختباره." };
  }
  if (progress === 100 && (status !== "done" || testStatus !== "passed")) {
    return { valid: false, message: "الوصول إلى 100% يتطلب حالة مكتمل ونتيجة اختبار ناجح." };
  }

  return { valid: true, message: "" };
}


/**
 * Fail closed: only the canonical, SSO-protected Vercel production alias may
 * write to the live database. GitHub Pages, Netlify production/previews,
 * deployment-specific Vercel URLs, localhost, and unknown hosts are read-only.
 * Add a custom domain here only after it is verified and protected.
 */
const APPROVED_WRITE_HOSTS = new Set(["wasla-app-gg2f.vercel.app"]);

export function isPreviewHost(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase();
  return !APPROVED_WRITE_HOSTS.has(host);
}


/** Run an async UI operation while reliably clearing its busy state. */
export async function runWithBusyState(state, operation) {
  state.busy = true;
  try {
    return await operation();
  } finally {
    state.busy = false;
  }
}
