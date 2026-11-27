// Bulk product import helpers: CSV parsing, Arabic template, chunking. Validation is done by the database (dry run first).
export const PRODUCT_AISLES = [
  ["dairy", "ألبان وأجبان"], ["grains", "أرز ومكرونة"], ["oils", "زيوت وسمن"], ["canned", "معلبات"], ["drinks", "مشروبات"],
  ["snacks", "سناكس وحلويات"], ["produce", "خضار وفاكهة"], ["meat", "لحوم ودواجن"], ["bakery", "مخبوزات"], ["coffee", "بن وشاي"],
  ["cleaning", "منظفات"], ["personal", "عناية شخصية"], ["household", "أدوات منزلية"], ["baby", "مستلزمات أطفال"], ["other", "أخرى"]
];

const HEADER_MAP = {
  "الاسم": "name", "اسم المنتج": "name", name: "name",
  "القسم": "aisle", aisle: "aisle",
  "التصنيف": "category", category: "category",
  "السعر": "price", "السعر بالجنيه": "price", price: "price",
  "المخزون": "stock", "الكمية": "stock", stock: "stock",
  "الوحدة": "unit", unit: "unit",
  "الباركود": "barcode", barcode: "barcode", sku: "barcode",
  "رابط الصورة": "image_url", image_url: "image_url", image: "image_url"
};

export const IMPORT_CHUNK = 1000;
export const IMPORT_MAX_ROWS = 10000;

export function arabicDigitsToLatin(text) {
  return String(text ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٫/g, ".");
}

export function parseCsv(text) {
  let src = String(text ?? "").replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": (first.match(/,/g) || []).length, ";": (first.match(/;/g) || []).length, "\t": (first.match(/\t/g) || []).length };
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i += 1; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

// Returns { rows: [{name, aisle, ...}], error }. Row i of the result is data row i+2 of the sheet (row 1 is the header).
export function rowsFromCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: "الملف فاضي أو من غير صفوف بيانات." };
  const keys = table[0].map((h) => HEADER_MAP[String(h).trim().toLowerCase()] || HEADER_MAP[String(h).trim()] || null);
  for (const need of ["name", "price", "stock"]) if (!keys.includes(need)) return { rows: [], error: "العمود الناقص: " + ({ name: "الاسم", price: "السعر", stock: "المخزون" })[need] + ". حمّل النموذج واستخدم نفس العناوين." };
  if (table.length - 1 > IMPORT_MAX_ROWS) return { rows: [], error: `الحد الأقصى ${IMPORT_MAX_ROWS} صف في الملف.` };
  const rows = table.slice(1).map((cells) => {
    const o = {};
    keys.forEach((k, i) => { if (k) o[k] = ["price", "stock"].includes(k) ? arabicDigitsToLatin(cells[i] ?? "").replace(/[,\s]/g, "") : String(cells[i] ?? "").trim(); });
    return o;
  });
  return { rows, error: "" };
}

export function templateCsv() {
  const head = ["الاسم", "القسم", "السعر", "المخزون", "الوحدة", "الباركود", "رابط الصورة"];
  const sample = [
    ["لبن كامل الدسم 1 لتر", "ألبان وأجبان", "38", "40", "عبوة", "6221000000011", ""],
    ["أرز مصري 1 كيلو", "أرز ومكرونة", "32", "100", "كيس", "6221000000028", ""],
    ["منظف أرضيات 1 لتر", "منظفات", "45", "25", "زجاجة", "", ""]
  ];
  return "\uFEFF" + [head, ...sample].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}

export function chunkRows(rows, size = IMPORT_CHUNK) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Merges per-chunk RPC results into one preview. Row numbers are mapped back to the sheet row (header = row 1).
export function mergeImportResults(results, size = IMPORT_CHUNK) {
  const total = { total: 0, new: 0, update: 0, errors: 0, warnings: 0, rows: [] };
  results.forEach((r, ci) => {
    total.total += r.total; total.new += r.new; total.update += r.update; total.errors += r.errors; total.warnings += r.warnings;
    (r.rows || []).forEach((x) => total.rows.push({ ...x, sheetRow: ci * size + x.n + 1 }));
  });
  return total;
}
