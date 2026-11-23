import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("anonymous Supabase requests send the publishable key without a Bearer token", () => {
  assert.match(source, /apikey:\s*CONFIG\.supabasePublishableKey/);
  assert.match(source, /\.\.\.\(token\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{token\}`\s*\}\s*:\s*\{\}\)/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer \$\{token\s*\|\|\s*CONFIG\.supabasePublishableKey\}`/);
});
