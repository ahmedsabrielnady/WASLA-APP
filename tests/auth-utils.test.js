import test from "node:test";
import assert from "node:assert/strict";
import { isEgyptianPhone, normalizeEgyptianPhone, resolveAuthIdentifier } from "../src/auth-utils.js";

test("normalizes Egyptian mobile numbers to E.164", () => {
  assert.equal(normalizeEgyptianPhone("01012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("201012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("00201012345678"), "+201012345678");
  assert.equal(normalizeEgyptianPhone("+201012345678"), "+201012345678");
});

test("rejects invalid Egyptian mobile numbers", () => {
  assert.equal(isEgyptianPhone("0101234567"), false);
  assert.equal(isEgyptianPhone("02012345678"), false);
  assert.equal(normalizeEgyptianPhone("not-a-number"), null);
});

test("classifies phone and email login identifiers", () => {
  assert.deepEqual(resolveAuthIdentifier("01012345678"), { type: "phone", value: "+201012345678" });
  assert.deepEqual(resolveAuthIdentifier("ahmed@example.com"), { type: "email", value: "ahmed@example.com" });
  assert.equal(resolveAuthIdentifier("not-valid"), null);
});
