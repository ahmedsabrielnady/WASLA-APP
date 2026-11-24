import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("customer orders expose a tracking action and render a status-only event timeline", () => {
  assert.match(main, /data-action="track-order"/);
  assert.match(main, /dataApi\.getMyOrderTracking\(orderId\)/);
  assert.match(main, /orderTrackingPanel\(order\)/);
  assert.match(main, /statusLabel\(entry\.status\)/);
  assert.doesNotMatch(main, /escapeHTML\(entry\.note\)/);
});
