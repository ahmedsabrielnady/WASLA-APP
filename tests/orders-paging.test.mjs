import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageSlice, ORDERS_PAGE_SIZE } from "../src/domain.js";

test("customer orders list is paged: 26 orders show 10 first, then 20, then all", () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: i }));
  let p = pageSlice(rows, ORDERS_PAGE_SIZE);
  assert.equal(p.items.length, 10);
  assert.equal(p.remaining, 16);
  p = pageSlice(rows, ORDERS_PAGE_SIZE * 2);
  assert.equal(p.items.length, 20);
  p = pageSlice(rows, ORDERS_PAGE_SIZE * 3);
  assert.equal(p.items.length, 26);
  assert.equal(p.remaining, 0);
});

test("the orders view wires the more-orders button to the page limit", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(src, /data-action="more-orders"/);
  assert.match(src, /action === "more-orders"/);
});

test("deliveries, open sessions and enrolments are paged through one more-list action", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  for (const key of ["deliveries", "sessions", "enrollments"]) assert.match(src, new RegExp(`pagedRows\\("${key}"`));
  assert.match(src, /action === "more-list"/);
});
