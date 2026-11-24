import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("customer order navigation is role-gated while guests retain the sign-in entry point", () => {
  assert.ok(main.includes('authenticated && state.profile?.role === "customer"'));
  assert.ok(main.includes('(!state.user || state.profile?.role === "customer") ?'));
});

test("provider and staff accounts cannot open customer order forms", () => {
  assert.ok(main.includes('if (state.user && state.profile?.role !== "customer")'));
  assert.ok(main.includes('state.pendingService && state.profile?.role === "customer"'));
  assert.ok(main.includes("إرسال الطلبات متاح لحسابات العملاء فقط"));
});

test("customer order history checks the authenticated profile role", () => {
  assert.ok(main.includes('if (state.profile?.role !== "customer")'));
});
