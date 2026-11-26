import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("roadmap card, nav button and page are staff/admin only", () => {
  assert.match(main, /function canSeeRoadmap\(\)[\s\S]{0,120}\["staff", "admin"\]/);
  assert.match(main, /canSeeRoadmap\(\) \? renderRoadmapHome\(/);
  assert.match(main, /canSeeRoadmap\(\) \? '<button class="nav-link" data-action="roadmap">/);
  assert.match(main, /state\.view === "roadmap" && canSeeRoadmap\(\) \? roadmapView\(\)/);
  assert.match(main, /if \(!canSeeRoadmap\(\)\) return;\s+await refreshRoadmap\(\)/);
});
