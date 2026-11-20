export const SECTORS = Object.freeze([
  { code: "clinic", title: "العيادات", icon: "🩺", description: "حجز كشف ومتابعة طبية", mode: "review" },
  { code: "nursing", title: "التمريض المنزلي", icon: "🧑‍⚕️", description: "رعاية وخدمات تمريض في المنزل", mode: "order" },
  { code: "food", title: "المطاعم", icon: "🍽️", description: "مطاعم وأكلات محلية", mode: "soon" },
  { code: "market", title: "الماركت", icon: "🛒", description: "احتياجات البيت والبقالة", mode: "soon" },
  { code: "maintenance", title: "الصيانة المنزلية", icon: "🧰", description: "سباكة وكهرباء وخدمات منزلية", mode: "order" },
  { code: "education", title: "التعليم", icon: "📚", description: "مدرسون ومتابعة تعليمية", mode: "soon" },
  { code: "car", title: "خدمات السيارات", icon: "🚗", description: "غسيل وبطارية وخدمات للسيارة", mode: "order" },
  { code: "delivery", title: "التوصيل", icon: "🚚", description: "توصيل الطلبات وتتبعها", mode: "review" }
]);

export const ORDERABLE_SECTORS = new Set(["nursing", "maintenance", "car"]);

export const STATUS_LABELS = Object.freeze({
  new: "طلب جديد",
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

export function isEgyptianPhone(value) {
  return /^01[0-9]{9}$/.test(String(value ?? "").trim());
}

export function isValidAddress(value) {
  const address = String(value ?? "").trim();
  return address.length >= 4 && address.length <= 255;
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
