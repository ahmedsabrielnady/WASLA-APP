import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECTORS, stripPictographs, sectorEntryPlan, sectorIconSvg, ICON_SVG, SECTOR_ANCHORS } from "../src/domain.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const domain = readFileSync(new URL("../src/domain.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("every sector has an inline SVG icon and no emoji is left in the UI source", () => {
  for (const s of SECTORS) assert.match(sectorIconSvg(s.code), /^<svg /);
  for (const k of ["user", "pin"]) assert.match(ICON_SVG[k], /^<svg /);
  const emoji = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;
  assert.doesNotMatch(domain, emoji);
  assert.doesNotMatch(main, emoji);
});

test("a visitor tapping a non-orderable sector is sent to login, never to unrelated services", () => {
  for (const code of ["clinic", "nursing", "food", "market", "education", "delivery"]) {
    assert.equal(sectorEntryPlan({ code, signedIn: false, isCustomer: false }).kind, "login", code);
  }
  assert.equal(sectorEntryPlan({ code: "car", signedIn: false, isCustomer: false }).kind, "services");
  assert.equal(sectorEntryPlan({ code: "maintenance", signedIn: false, isCustomer: false }).kind, "services");
});

test("a signed-in customer is routed to the matching rendered section, else an honest unavailable state", () => {
  const have = (...ids) => new Set(ids);
  assert.deepEqual(sectorEntryPlan({ code: "clinic", signedIn: true, isCustomer: true, present: have("clinic") }), { kind: "scroll", anchor: "clinic", exact: true, delivery: false });
  const h = sectorEntryPlan({ code: "clinic", signedIn: true, isCustomer: true, present: have("lab-prices") });
  assert.equal(h.anchor, "lab-prices"); assert.equal(h.exact, false);
  assert.equal(sectorEntryPlan({ code: "nursing", signedIn: true, isCustomer: true, present: have("nursing") }).anchor, "nursing");
  assert.equal(sectorEntryPlan({ code: "market", signedIn: true, isCustomer: true, present: have("store") }).anchor, "store");
  assert.equal(sectorEntryPlan({ code: "food", signedIn: true, isCustomer: true, present: have("food") }).anchor, "food");
  assert.equal(sectorEntryPlan({ code: "education", signedIn: true, isCustomer: true, present: have("course-catalogue") }).anchor, "course-catalogue");
  assert.equal(sectorEntryPlan({ code: "delivery", signedIn: true, isCustomer: true, present: have("store") }).delivery, true);
  assert.equal(sectorEntryPlan({ code: "nursing", signedIn: true, isCustomer: true, present: have("food") }).kind, "unavailable");
  assert.equal(sectorEntryPlan({ code: "clinic", signedIn: true, isCustomer: false }).kind, "customer-only");
  assert.ok(Object.keys(SECTOR_ANCHORS).every((c) => SECTORS.some((s) => s.code === c)));
});

test("sector tap handler no longer scrolls to #services for every sector", () => {
  const h = main.slice(main.indexOf('action === "sector"'), main.indexOf('action === "reload"'));
  assert.match(h, /sectorEntryPlan/);
  assert.match(h, /openAuth\("login"\)/);
  assert.doesNotMatch(h, /قيد التجهيز وسيظهر/);
});

test("touch targets: 44px minimum for header controls, small buttons, search and legal links at phone width", () => {
  const block = css.slice(css.indexOf("/* Inline SVG icons"));
  for (const sel of [".nav-link, .account-chip", ".btn-small", ".search-box", ".site-footer a"]) assert.ok(block.includes(sel), sel);
  assert.equal((block.match(/min-height: 44px/g) || []).length >= 4, true);
});

test("checkboxes and consent links get a 44px hit area at phone width", () => {
  assert.match(css, /input\[type="checkbox"\], input\[type="radio"\] \{ width: 22px; height: 22px/);
  assert.match(css, /label:has\(input\[type="checkbox"\]\) \{ display: flex; align-items: center; gap: 10px; min-height: 44px/);
});

test("ticker text drops pictographs and keeps the words", () => {
  assert.equal(stripPictographs("🚚 توصيل مجاني للعميل"), "توصيل مجاني للعميل");
  assert.equal(stripPictographs("خصم ٢٠٪ 🎉🎉 على الماركت"), "خصم ٢٠٪ على الماركت");
  assert.equal(stripPictographs("نص عادي 123"), "نص عادي 123");
  assert.equal(stripPictographs("🛒"), "");
  assert.equal(stripPictographs(null), "");
  assert.match(main, /stripPictographs\(offer\.text\)/);
});

test("auth modal hides signup and email-registration copy when signup is closed", () => {
  const m = main.slice(main.indexOf("function authModal()"), main.indexOf("function passwordResetModal()"));
  assert.match(m, /const signupClosed = CONFIG\.isPublicPreview \|\| CONFIG\.isTestBackend/);
  assert.match(m, /state\.authMode === "register" && !signupClosed/);
  assert.match(m, /signupClosed\s*\? `<p class="form-footnote preview-auth-note">/);
  assert.match(m, /\$\{signupClosed \? "" : `<p class="form-footnote">/);
  assert.doesNotMatch(m, /!CONFIG\.isPublicPreview/);
});

test("header login button does not offer a new account when signup is closed", () => {
  assert.match(main, /CONFIG\.isPublicPreview \|\| CONFIG\.isTestBackend \? "تسجيل الدخول" : "دخول \/ حساب جديد"/);
});

test("brand link keeps a 44px touch target", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.brand \{ display: inline-flex; align-items: center; gap: 11px; min-height: 44px; \}/);
});

test("delivery sends a signed-in customer to the delivery request form first, then to store or food orders", () => {
  const have = (...ids) => new Set(ids);
  assert.equal(sectorEntryPlan({ code: "delivery", signedIn: true, isCustomer: true, present: have("delivery-request", "store") }).anchor, "delivery-request");
  assert.equal(sectorEntryPlan({ code: "delivery", signedIn: true, isCustomer: true, present: have("food") }).anchor, "food");
});
