import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/live-patches/20261125_harden_security_definer_search_paths.sql", import.meta.url),
  "utf8",
);

const hardenedFunctions = [
  "accept_consent(text, text)",
  "admin_reset_user_password(text, text)",
  "approve_provider(uuid)",
  "current_provider_id()",
  "current_role_name()",
  "is_staff()",
  "my_order_suggestions()",
  "my_order_tracking(uuid)",
  "set_order_location(uuid, double precision, double precision, text)",
];

test("security-definer hardening archive pins an empty search_path on every live-patched function", () => {
  for (const signature of hardenedFunctions) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      sql,
      new RegExp(`alter\\s+function\\s+public\\.${escaped}\\s+set\\s+search_path\\s*=\\s*''\\s*;`, "i"),
      `missing hardened search_path for public.${signature}`,
    );
  }
  assert.equal((sql.match(/alter\\s+function\\s+public\\./gi) || []).length, hardenedFunctions.length);
});

test("security-definer hardening archive does not change grants or application data", () => {
  assert.doesNotMatch(sql, /\\b(grant|revoke|insert|update|delete|truncate|drop)\\b/i);
});
