import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("health timeline is customer-only, read-only, capped, and merges only the user's own loaded data", () => {
  const body = main.slice(main.indexOf("function healthTimelineSection"), main.indexOf("function labRequestsSection"));
  assert.match(body, /role !== "customer"\) return ""/);
  assert.match(body, /result_ready" && \(r\.result_text \|\| r\.result_file_path\) && r\.updated_at/);
  assert.match(body, /\.slice\(0, 15\)/);
  for (const src of ["state.myOrders", "state.medicalNotes", "state.prescriptions", "state.labRequests"]) assert.ok(body.includes(src), src);
  assert.doesNotMatch(body, /data-action|<form|dataApi\./);
  assert.match(body, /ووصلة لا تفسّرها/);
});
