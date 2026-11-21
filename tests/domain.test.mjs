import test from "node:test";
import assert from "node:assert/strict";
import {
  SECTORS,
  canRequestService,
  escapeHTML,
  formatEGP,
  isEgyptianPhone,
  isValidAddress,
  isValidCoordinates,
  sectorLabel,
  statusLabel
} from "../src/domain.js";

test("only service sectors with live supported order flow are orderable", () => {
  assert.equal(canRequestService({ sector: "nursing", id: 1 }), true);
  assert.equal(canRequestService({ sector: "maintenance", id: 2 }), true);
  assert.equal(canRequestService({ sector: "car", id: 3 }), true);
  assert.equal(canRequestService({ sector: "clinic", id: 4 }), false);
  assert.equal(canRequestService({ sector: "delivery", id: 5 }), false);
  assert.equal(canRequestService({ sector: "food", id: 6 }), false);
  assert.equal(canRequestService(null), false);
});

test("the eight intended WASLA sectors are present", () => {
  assert.deepEqual(SECTORS.map((sector) => sector.code), [
    "clinic", "nursing", "food", "market",
    "maintenance", "education", "car", "delivery"
  ]);
});

test("Egyptian mobile number validation matches the database format", () => {
  assert.equal(isEgyptianPhone("01012345678"), true);
  assert.equal(isEgyptianPhone("01112345678"), true);
  assert.equal(isEgyptianPhone("0101234567"), false);
  assert.equal(isEgyptianPhone("+201012345678"), false);
  assert.equal(isEgyptianPhone("01A12345678"), false);
});

test("address validation uses the current orders table constraints", () => {
  assert.equal(isValidAddress("شارع المحطة"), true);
  assert.equal(isValidAddress("بيت"), false);
  assert.equal(isValidAddress("x".repeat(256)), false);
});

test("database text is escaped before insertion into markup", () => {
  assert.equal(escapeHTML("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHTML("وصلة & WASLA"), "وصلة &amp; WASLA");
});

test("sector and status labels have safe fallbacks", () => {
  assert.equal(sectorLabel("maintenance"), "الصيانة المنزلية");
  assert.equal(sectorLabel("not-a-sector"), "خدمة وصلة");
  assert.equal(statusLabel("new"), "طلب جديد");
  assert.equal(statusLabel("unrecognised"), "حالة غير معروفة");
});

test("EGP formatter handles absent and numeric values", () => {
  assert.equal(formatEGP(null), "يتحدد بعد المعاينة");
  assert.match(formatEGP(150), /١٥٠|150/);
});

test("GPS coordinate validation enforces latitude and longitude ranges", () => {
  assert.equal(isValidCoordinates(30.32, 31.25), true);
  assert.equal(isValidCoordinates(-90, 180), true);
  assert.equal(isValidCoordinates(90.01, 31), false);
  assert.equal(isValidCoordinates(30, -181), false);
  assert.equal(isValidCoordinates("north", 31), false);
});
