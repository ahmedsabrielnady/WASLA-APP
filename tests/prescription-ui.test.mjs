import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("prescription UI requires an explicit pharmacy choice and consent, and never offers a broadcast", () => {
  assert.match(main, /data-form="prescription"/);
  assert.match(main, /name="consent"/);
  assert.match(main, /الصيدليات التي اخترتها فقط/);
  assert.doesNotMatch(main, /كل الصيدليات/);
});

test("prescription API sets audience with consent after upload and closes the request if a later step fails", () => {
  const start = api.indexOf("async submitPrescription");
  const body = api.slice(start, api.indexOf("async closePrescription"));
  assert.match(body, /values\?\.consent !== true/);
  assert.ok(body.indexOf("attach_prescription_file") < body.indexOf("rx_set_audience"));
  assert.match(body, /customer_close_prescription_request/);
  assert.match(body, /5 \* 1024 \* 1024/);
});

test("live writes are blocked outside the production host for prescriptions", () => {
  assert.match(api, /assertLiveWritesAllowed\("إرسال روشتة"\)/);
  assert.match(api, /assertLiveWritesAllowed\("إغلاق الطلب"\)/);
});

test("health sections render only when the optional tables exist", () => {
  assert.match(main, /if \(!Array\.isArray\(state\.prescriptions\)\) return "";/);
  assert.match(main, /if \(!Array\.isArray\(state\.labTests\) \|\| !state\.labTests\.length\) return "";/);
});
