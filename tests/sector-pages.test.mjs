import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("tapping a section opens its own page instead of scrolling the home page", () => {
  const handler = main.slice(main.indexOf('action === "sector"'), main.indexOf('action === "sector"') + 1800);
  assert.match(handler, /openSectorPage\(code\)/);
  assert.doesNotMatch(handler, /scrollIntoView/);
  assert.match(main, /state\.view === "sector" \? sectorView\(\)/);
});

test("every non-order section has its own panels on its page", () => {
  const panels = main.slice(main.indexOf("function sectorPanels"), main.indexOf("function sectorView"));
  for (const code of ["clinic", "nursing", "food", "market", "education", "delivery"]) assert.match(panels, new RegExp(`case "${code}"`));
});

test("order sections list only their own services", () => {
  assert.match(main, /function serviceCards\(onlySector = null\)/);
  assert.match(main, /item\.sector !== onlySector/);
  assert.match(main, /serviceCards\(sector\.code\)/);
});

test("section pages have a way back and an honest empty state", () => {
  const view = main.slice(main.indexOf("function sectorView"), main.indexOf("function orderTrackingPanel"));
  assert.match(view, /data-action="home"/);
  assert.match(view, /لا يوجد مقدمو خدمة معتمدون/);
});
