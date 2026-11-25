import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPreviewHost, TEST_BACKEND } from "../src/domain.js";

const PROD = "https://yfgvimcqbtthnrbzbhft.supabase.co";
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const domain = readFileSync(new URL("../src/domain.js", import.meta.url), "utf8");

test("only the alias host switches to the test backend; production URL stays for every other host", () => {
  assert.match(config, /const ON_TEST_ALIAS = Boolean\(TEST_WRITE_HOST\) && HOST === TEST_WRITE_HOST/);
  assert.match(config, /ON_TEST_ALIAS \? TEST_BACKEND : "https:\/\/yfgvimcqbtthnrbzbhft\.supabase\.co"/);
  assert.match(config, /supabasePublishableKey: ON_TEST_ALIAS \? TEST_PUBLISHABLE_KEY : /);
  assert.equal(TEST_BACKEND, "https://mekeirlgmergmzsdkaon.supabase.co");
});

test("no secret-looking keys in the committed config (publishable key only)", () => {
  assert.doesNotMatch(config, /sb_secret|service_role|eyJ[A-Za-z0-9_-]{20}/);
});

test("write host for the test backend is the one configured alias; empty fails closed", () => {
  const m = domain.match(/const TEST_WRITE_HOST = "([^"]*)"/);
  assert.ok(m, "TEST_WRITE_HOST constant exists");
  const alias = m[1];
  if (!alias) {
    assert.equal(isPreviewHost("anything.pages.dev", TEST_BACKEND), true);
  } else {
    assert.equal(alias, "wasla-app-d5v.pages.dev");
    assert.equal(isPreviewHost(alias, TEST_BACKEND), false, "alias may write to test backend");
    assert.equal(isPreviewHost(alias.toUpperCase(), TEST_BACKEND), false, "host compare is case-insensitive");
    assert.equal(isPreviewHost("79883eee.wasla-app-d5v.pages.dev", TEST_BACKEND), true, "per-deployment host is read-only");
    assert.equal(isPreviewHost("x." + alias, TEST_BACKEND), true, "sub-host of alias is read-only");
    assert.equal(isPreviewHost(alias, PROD), true, "alias must never write to production");
  }
  assert.equal(isPreviewHost("wasla-app-gg2f.vercel.app", TEST_BACKEND), true, "production host with test backend stays read-only");
  assert.equal(isPreviewHost("localhost", TEST_BACKEND), true);
  assert.equal(isPreviewHost("wasla-app-gg2f.vercel.app", PROD), false, "production rule unchanged");
  assert.equal(isPreviewHost("wasla-app-gg2f.vercel.app"), false, "default backend arg keeps old behavior");
  assert.equal(isPreviewHost("wasla-app-gg2f.vercel.app", "https://other.supabase.co"), true, "unknown backend is read-only");
});
