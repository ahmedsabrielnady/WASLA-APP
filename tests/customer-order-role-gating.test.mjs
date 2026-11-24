import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("only customer accounts are offered customer order history", () => {
  assert.match(main, /authenticated && state\.profile\?\.role === "customer".*data-action="orders"/s);
  assert.match(main, /state\.profile\?\.role === "customer" \? '<button class="btn btn-glass" data-action="orders">تابع طلباتك/);
});

test("provider and staff accounts cannot open customer order forms", () => {
  assert.match(main, /if \(state\.user && state\.profile\?\.role !== "customer"\)[\s\S]{0,140}إرسال الطلبات متاح لحسابات العملاء فقط/);
  assert.match(main, /state\.pendingService && state\.profile\?\.role === "customer"/);
  assert.match(main, /إرسال الطلبات متاح لحسابات العملاء فقط/);
});

test("customer order history checks the authenticated profile role", () => {
  assert.match(main, /async function refreshMyOrders\(\)[\s\S]{0,280}state\.profile\?\.role !== "customer"/);
});
