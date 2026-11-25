import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { googleDisplayName, shouldAdoptGoogleName, shouldShowGoogleButton } from "../src/auth-utils.js";

const gUser = { id: "u1", identities: [{ provider: "email" }, { provider: "google" }], user_metadata: { full_name: "  Ahmed   Sabri " } };

test("Google button shows for login when enabled, even with signup closed", () => {
  assert.equal(shouldShowGoogleButton({ googleEnabled: true, isPublicPreview: false, register: false }), true);
});
test("Google button hidden when disabled, in public preview, or in register mode", () => {
  assert.equal(shouldShowGoogleButton({ googleEnabled: false, isPublicPreview: false, register: false }), false);
  assert.equal(shouldShowGoogleButton({ googleEnabled: true, isPublicPreview: true, register: false }), false);
  assert.equal(shouldShowGoogleButton({ googleEnabled: true, isPublicPreview: false, register: true }), false);
});
test("main.js keeps register hidden when signup is closed", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(src, /const register = state\.authMode === "register" && !signupClosed/);
  assert.match(src, /shouldShowGoogleButton\(\{ googleEnabled: state\.googleAuthEnabled/);
});
test("Google name is read only from a linked Google identity and normalised", () => {
  assert.equal(googleDisplayName(gUser), "Ahmed Sabri");
  assert.equal(googleDisplayName({ ...gUser, identities: [{ provider: "email" }] }), "");
  assert.equal(googleDisplayName({ ...gUser, user_metadata: { full_name: "A" } }), "");
  assert.equal(googleDisplayName({ ...gUser, user_metadata: { name: "x".repeat(61) } }), "");
});
test("name is adopted only for the same user with a blank or default profile name", () => {
  assert.equal(shouldAdoptGoogleName({ id: "u1", full_name: "مستخدم" }, gUser), true);
  assert.equal(shouldAdoptGoogleName({ id: "u1", full_name: null }, gUser), true);
  assert.equal(shouldAdoptGoogleName({ id: "u1", full_name: "My Own Name" }, gUser), false);
  assert.equal(shouldAdoptGoogleName({ id: "u2", full_name: "مستخدم" }, gUser), false);
});
test("name update is a conditional own-profile PATCH that never touches role", () => {
  const src = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("async adoptGoogleName"), src.indexOf("async getRoadmap"));
  assert.match(block, /full_name\.is\.null/);
  assert.doesNotMatch(block, /role/);
});

import { hasGoogleIdentity, shouldShowLinkGoogle } from "../src/auth-utils.js";

test("Link Google shows only for signed-in users without a Google identity", () => {
  const base = { googleEnabled: true, isPublicPreview: false };
  assert.equal(shouldShowLinkGoogle({ ...base, user: { id: "u1", identities: [{ provider: "email" }] } }), true);
  assert.equal(shouldShowLinkGoogle({ ...base, user: { id: "u1", identities: [{ provider: "email" }, { provider: "google" }] } }), false);
  assert.equal(shouldShowLinkGoogle({ ...base, user: null }), false);
  assert.equal(shouldShowLinkGoogle({ ...base, googleEnabled: false, user: { id: "u1", identities: [] } }), false);
  assert.equal(shouldShowLinkGoogle({ ...base, isPublicPreview: true, user: { id: "u1", identities: [] } }), false);
  assert.equal(hasGoogleIdentity({ identities: [{ provider: "google" }] }), true);
});

test("linkGoogle uses the signed-in token, PKCE and the identities endpoint, and never sends a password", () => {
  const src = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("async linkGoogle"), src.indexOf("async acceptOAuthFromUrl"));
  assert.match(block, /\/auth\/v1\/user\/identities\/authorize/);
  assert.match(block, /code_challenge_method: "s256"/);
  assert.match(block, /token: session\.access_token/);
  assert.doesNotMatch(block, /password/);
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /action === "link-google"/);
});
