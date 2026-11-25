import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("lab result file: restricted types, 5 MB cap, private bucket, cleanup on failed publish", () => {
  assert.match(main, /accept="application\/pdf,image\/jpeg,image\/png"/);
  assert.match(api, /labPublishResultFile/);
  assert.match(api, /file\.size > 5 \* 1024 \* 1024/);
  assert.match(api, /storage\/v1\/object\/lab-results\//);
  assert.match(api, /storage\/v1\/object\/authenticated\/lab-results\//);
  assert.doesNotMatch(api, /object\/public\/lab-results/);
  assert.match(api, /method: "DELETE"/);
});

test("patient opens the file through an authenticated blob read, labelled as lab-authored", () => {
  assert.match(main, /data-action="open-lab-file"/);
  assert.match(main, /عرض ملف النتيجة \(كتبه المعمل\)/);
  assert.match(main, /action === "open-lab-file"/);
});
