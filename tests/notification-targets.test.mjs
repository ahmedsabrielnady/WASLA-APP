import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("every new notification kind maps to a card id that the page renders", () => {
  assert.match(main, /delivery_status: "delivery"/);
  assert.match(main, /prescription_quote: "rx"/);
  assert.match(main, /prescription_quote_revised: "rx"/);
  assert.match(main, /session_cancelled: "session"/);
  assert.match(main, /session_link: "session"/);
  assert.match(main, /id="delivery-\$\{escapeHTML\(item\.id\)\}"/);
  assert.match(main, /id="rx-\$\{escapeHTML\(r\.id\)\}"/);
  assert.match(main, /id="session-\$\{escapeHTML\(e\.session_id\)\}"/);
});

test("navigation only scrolls to a card the user's own data rendered, else shows a clear message", () => {
  assert.match(main, /const card = document\.getElementById\(`\$\{button\.dataset\.targetType\}-\$\{button\.dataset\.targetId\}`\);\s*if \(!card\) throw new Error/);
  assert.match(main, /الحصة دي اتلغت ومش ظاهرة في تسجيلاتك/);
});

test("labels come from the user's own loaded data, never from the notification payload", () => {
  assert.match(main, /function notificationTargetLabel\(n\)/);
  assert.doesNotMatch(main, /n\.label|n\.title|n\.body/);
});

test("a notice whose source data is unavailable keeps an opaque non-clinical reference from the id", () => {
  assert.match(main, /const opaque = n\.ref_id \? `#\$\{String\(n\.ref_id\)\.slice\(0, 4\)\.toUpperCase\(\)\}` : ""/);
  assert.match(main, /targetLabel \|\| \(targetType \? opaque : ""\)/);
});

test("the registrations list shows only booked enrollments with a readable session", () => {
  assert.match(main, /const liveEnrollments = \(state\.enrollments \|\| \[\]\)\.filter\(\(e\) => e\.status === "booked" && e\.session\?\.title\)/);
  assert.match(main, /const mine = pagedRows\("enrollments", liveEnrollments/);
});
