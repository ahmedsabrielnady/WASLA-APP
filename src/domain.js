export const SECTORS = Object.freeze([
  { code: "clinic", title: "العيادات", description: "حجز كشف ومتابعة طبية", mode: "review" },
  { code: "nursing", title: "التمريض المنزلي", description: "يُتاح بعد استكمال متطلبات الخصوصية والبيانات الصحية", mode: "review" },
  { code: "food", title: "المطاعم", description: "مطاعم وأكلات محلية", mode: "soon" },
  { code: "market", title: "الماركت", description: "احتياجات البيت والبقالة", mode: "soon" },
  { code: "maintenance", title: "الصيانة المنزلية", description: "سباكة وكهرباء وخدمات منزلية", mode: "order" },
  { code: "education", title: "التعليم", description: "مدرسون ومتابعة تعليمية", mode: "soon" },
  { code: "car", title: "خدمات السيارات", description: "غسيل وبطارية وخدمات للسيارة", mode: "order" },
  { code: "delivery", title: "التوصيل", description: "توصيل الطلبات وتتبعها", mode: "review" }
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
  picked_up: "تم الاستلام من المرسل",
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
  if (value === "store") return "المتجر";
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

const PRODUCTION_BACKEND = "https://yfgvimcqbtthnrbzbhft.supabase.co";
export const TEST_BACKEND = "https://mekeirlgmergmzsdkaon.supabase.co";
/**
 * Isolated test preview. The test backend may be written from exactly one
 * host: the Cloudflare Pages project host that serves the dev branch (per-deployment hosts stay read-only). Empty means no host may write (fail closed).
 * Only that alias is switched to the test backend (see config.js); every other host keeps the production backend and the production rule above.
 */
export const TEST_WRITE_HOST = "wasla-app-d5v.pages.dev";

export function isPreviewHost(hostname, backendUrl = PRODUCTION_BACKEND) {
  const host = String(hostname ?? "").trim().toLowerCase();
  const backend = String(backendUrl ?? "").trim().replace(/\/+$/, "");
  if (backend === TEST_BACKEND) return !TEST_WRITE_HOST || host !== TEST_WRITE_HOST;
  if (backend === PRODUCTION_BACKEND) return !APPROVED_WRITE_HOSTS.has(host);
  return true;
}


/** Run an async UI operation while reliably clearing its busy state. */
export async function runWithBusyState(state, operation) {
  if (state.busy) throw new Error("جارٍ تنفيذ عملية أخرى. انتظر قليلًا.");
  state.busy = true;
  try {
    return await operation();
  } finally {
    state.busy = false;
  }
}

// Inline SVG icons. Emoji glyphs rendered as empty boxes on devices without an emoji font; SVG renders everywhere.
const svg = (body) => `<svg class="svg-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
export const ICON_SVG = Object.freeze({
  clinic: svg('<path d="M12 6v12M6 12h12"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>'),
  nursing: svg('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6"/><path d="M12 15.5v3M10.5 17h3"/>'),
  food: svg('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2.4 1.6-3.5 4.2-3.5 7.5V14H17"/>'),
  market: svg('<path d="M3 4h2.4l2 10.2h9.4L19 7.5H6.3"/><circle cx="9" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>'),
  maintenance: svg('<path d="M14.5 6.2a4 4 0 0 0 4.8 4.8L11 19.3a2.1 2.1 0 0 1-3-3l8.3-8.3a4 4 0 0 0-1.8-1.8z"/>'),
  education: svg('<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M7 12v4.2c1.4 1.3 3.1 2 5 2s3.6-.7 5-2V12"/>'),
  car: svg('<path d="M4 15v-3l1.7-4.4A2 2 0 0 1 7.6 6.3h8.8a2 2 0 0 1 1.9 1.3L20 12v3"/><path d="M3.5 15h17v2.5h-17z"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/>'),
  delivery: svg('<path d="M3 6h11v10H3z"/><path d="M14 9.5h4l3 3.2V16h-7z"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.7 3.4-5.8 7-5.8s6.3 2.1 7 5.8"/>'),
  pin: svg('<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  spark: svg('<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/>')
});
export function sectorIconSvg(code) { return ICON_SVG[code] || ICON_SVG.spark; }

// What a tap on a home sector card does. Pure, so it is testable. `present` is the set of section ids rendered on the customer page.
// Honest states: no real provider is implied; an empty section says so.
export const SECTOR_ANCHORS = Object.freeze({
  clinic: ["clinic", "lab-prices", "prescriptions", "supplies", "health-timeline"],
  nursing: ["nursing"],
  food: ["food"],
  market: ["store"],
  education: ["education", "course-catalogue"],
  delivery: ["store", "food"]
});
export function sectorEntryPlan({ code, signedIn, isCustomer, present = new Set() }) {
  const sector = SECTORS.find((entry) => entry.code === code);
  if (!sector) return { kind: "unknown" };
  if (sector.mode === "order") return { kind: "services" };
  if (!signedIn) return { kind: "login" };
  if (!isCustomer) return { kind: "customer-only" };
  const anchors = SECTOR_ANCHORS[code] || [];
  const found = anchors.find((id) => present.has(id));
  if (!found) return { kind: "unavailable" };
  return { kind: "scroll", anchor: found, exact: found === anchors[0], delivery: code === "delivery" };
}

// Offer text comes from the platform database. Pictographs render as empty boxes without an emoji font, so the ticker shows the text only.
export function stripPictographs(value) {
  return String(value ?? "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

// The server refuses a patient file with an English message when the doctor has no case with that patient. Show it in Arabic, keep other messages.
export function patientFileDeniedMessage(message) {
  const text = String(message || "");
  if (/no care relationship/i.test(text)) return "مفيش حالة بينك وبين المريض ده، فمش هتقدر تفتح ملفه.";
  return text || "تعذر فتح الملف.";
}

// Doctor patient file lists show the newest rows first in pages, so a file with hundreds of cases stays usable on a phone.
export const FILE_PAGE_SIZE = 20;
export function pageSlice(list, limit = FILE_PAGE_SIZE) {
  const all = Array.isArray(list) ? list : [];
  const n = Math.max(1, Number(limit) || FILE_PAGE_SIZE);
  return { items: all.slice(0, n), remaining: Math.max(0, all.length - n) };
}
