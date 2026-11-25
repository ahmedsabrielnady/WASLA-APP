import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("patient lab results are labelled as lab-authored with no Wasla diagnosis", () => {
  assert.match(main, /النتيجة كتبها المعمل\. وصلة لا تفسّر النتائج ولا تقدم تشخيصًا/);
  assert.match(main, /السعر وقت الطلب/);
});

test("lab notices carry generic text and target lab cards by id, without the test name", () => {
  assert.match(main, /lab_status: "lab"/);
  assert.match(main, /lab_result_ready: "lab"/);
  assert.match(main, /id="lab-\$\{escapeHTML\(r\.id\)\}"/);
  const t = main.match(/lab_status: "([^"]+)"/)[1] + main.match(/lab_result_ready: "([^"]+)"/)[1];
  assert.doesNotMatch(t, /تحليل|أشعة|نتيجة إيجابية|سعر|جنيه/);
  assert.doesNotMatch(main.match(/if \(type === "lab"\)[^\n]*/)[0], /test\?\.name/);
});

test("result length is checked before the rpc and writes use the live-write guard", () => {
  assert.match(api, /النتيجة من 3 إلى 2000 حرف/);
  assert.match(api, /labRpc\(name, body, label\) \{\s*assertLiveWritesAllowed\(label\)/);
});
