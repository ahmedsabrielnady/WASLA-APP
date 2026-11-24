import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("guest order intent survives email confirmation page reload", () => {
  assert.ok(main.includes('localStorage.setItem(PENDING_ORDER_SERVICE_KEY, String(item.id))'));
  assert.ok(main.includes('localStorage.getItem(PENDING_ORDER_SERVICE_KEY)'));
  assert.ok(main.includes('authApi.acceptSignupFromUrl()'));
  assert.ok(main.includes('state.profile?.role === "customer"'));
  assert.ok(main.includes('state.modal = "order"'));
});

test("new customers enter registration directly from a service card", () => {
  assert.ok(main.includes('if (!state.user) {\n    openAuth("register");'));
});

test("pending service intent is cleared after success, explicit close, or incompatible role", () => {
  assert.ok(main.includes('localStorage.removeItem(PENDING_ORDER_SERVICE_KEY)'));
  assert.ok(main.includes('تم استلام ${ref}'));
});
