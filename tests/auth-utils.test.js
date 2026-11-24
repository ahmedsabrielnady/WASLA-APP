import test from "node:test";
import assert from "node:assert/strict";
import { isEgyptianPhone, isPhoneAliasSignupReady, normalizeEgyptianPhone, resolveAuthIdentifier, toWaslaAuthEmail } from "../src/auth-utils.js";

test("normalizes Egyptian mobile numbers to E.164", () => {
  assert.equal(normalizeEgyptianPhone("01012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("201012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("00201012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("+201012345678"), "+201012345678");
});

test("rejects invalid Egyptian mobile numbers", () => {
  assert.equal(isEgyptianPhone("0101234567"), false);
  assert.equal(isEgyptianPhone("02012345678"), false);
  assert.equal(isEgyptianPhone("01312345678"), false);
  assert.equal(normalizeEgyptianPhone("01412345678"), null);
  assert.equal(normalizeEgyptianPhone("not-a-number"), null);
});

test("classifies phone and email login identifiers", () => {
  assert.deepEqual(resolveAuthIdentifier("01012345678"), { type: "phone", value: "+201012345678" });
  assert.deepEqual(resolveAuthIdentifier("ahmed@example.com"), { type: "email", value: "ahmed@example.com" });
  assert.equal(resolveAuthIdentifier("not-valid"), null);
});

test("maps Egyptian phone numbers to stable WASLA email aliases", () => {
  assert.equal(toWaslaAuthEmail("01012345678"), "01012345678@wasla.app");
  assert.equal(toWaslaAuthEmail("+201012345678"), "01012345678@wasla.app");
  assert.equal(toWaslaAuthEmail("00201012345678"), "01012345678@wasla.app");
  assert.equal(toWaslaAuthEmail("ahmed@example.com"), "ahmed@example.com");
  assert.equal(toWaslaAuthEmail("invalid"), null);
});

test("phone alias signup requires email auto-confirm and enabled email auth", () => {
  assert.equal(isPhoneAliasSignupReady({ external: { email: true }, mailer_autoconfirm: true }), true);
  assert.equal(isPhoneAliasSignupReady({ external: { email: true }, mailer_autoconfirm: false }), false);
  assert.equal(isPhoneAliasSignupReady({ external: { email: false }, mailer_autoconfirm: true }), false);
  assert.equal(isPhoneAliasSignupReady(null), false);
});
