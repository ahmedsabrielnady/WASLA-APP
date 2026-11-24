import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, supabase, terms, privacy, cancellation] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/supabase.js", import.meta.url), "utf8"),
  readFile(new URL("../terms.html", import.meta.url), "utf8"),
  readFile(new URL("../privacy.html", import.meta.url), "utf8"),
  readFile(new URL("../cancellation.html", import.meta.url), "utf8")
]);

test("registration and order consent controls link to the corresponding policy drafts", () => {
  assert.ok((main.match(/href="\.\/terms\.html"/g) || []).length >= 2);
  assert.ok((main.match(/href="\.\/privacy\.html"/g) || []).length >= 2);
  assert.match(main, /href="\.\/cancellation\.html"/);
  assert.match(main, /data-action="customer-cancel-order"/);
  assert.match(main, /order\.status === "new"/);
});

test("consent records the exact draft policy version shown on the policy pages", () => {
  assert.match(supabase, /const POLICY_VERSION = "draft-2026-11-24.2"/);
  assert.match(supabase, /p_version: POLICY_VERSION/);
  for (const page of [terms, privacy, cancellation]) {
    assert.match(page, /draft-2026-11-24/);
    assert.match(page, /مسودة تشغيلية وليست وثيقة قانونية معتمدة/);
  }
});

test("privacy draft does not invent a retention period or a support contact", () => {
  assert.match(privacy, /مدة الاحتفاظ النهائية/);
  assert.match(privacy, /لم تُدرج بعد بيانات مسؤول الخصوصية/);
  assert.match(cancellation, /إلغاء الطلب ذاتيًا/);
  assert.match(cancellation, /قبل تأكيده/);
});
