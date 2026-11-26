import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVAL_SECTORS, approvalSectorsFor, renderOperationsView } from "../src/operations.js";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("sections offered depend on the provider kind", () => {
  assert.deepEqual(approvalSectorsFor("doctor").map((s) => s.code), ["clinic"]);
  assert.deepEqual(approvalSectorsFor("technician").map((s) => s.code).sort(), ["car", "maintenance"]);
  assert.deepEqual(approvalSectorsFor("teacher").map((s) => s.code), ["education"]);
  assert.equal(approvalSectorsFor("nobody").length, 0);
  for (const def of Object.values(APPROVAL_SECTORS)) assert.ok(def.specialties.length > 0);
});

const pending = { id: "p1", kind: "technician", display_name: "فني جديد", approved: false, active: true, is_test: false };
const view = (role, drafts = {}) => renderOperationsView({ profile: { role }, providers: [pending], orders: [], services: [], approvalDrafts: drafts });

test("founder sees section, then specialty, then name and price in one form; specialty is locked until a section is chosen", () => {
  const html = view("admin");
  assert.match(html, /data-form="approve-provider-service"/);
  assert.ok(html.indexOf("1. القسم") < html.indexOf("2. التخصص") && html.indexOf("2. التخصص") < html.indexOf("3. اسم مقدم الخدمة") && html.indexOf("3. اسم مقدم الخدمة") < html.indexOf("4. سعر الخدمة"));
  assert.match(html, /name="specialty" required disabled/);
  const chosen = view("admin", { p1: { sector: "maintenance" } });
  assert.match(chosen, /<option value="سباكة"/);
  assert.doesNotMatch(chosen, /name="specialty" required disabled/);
  assert.doesNotMatch(chosen, /<option value="باطنة"/);
});

test("the approval list comes before the catalogue and orders for the founder; staff keep the plain approve button", () => {
  const html = view("admin");
  assert.ok(html.indexOf("طلبات الانضمام") < html.indexOf("أسعار الخدمات"));
  const staff = view("staff");
  assert.match(staff, /data-action="approve-provider"/);
  assert.doesNotMatch(staff, /approve-provider-service/);
});

test("the draft is admin-only and checks kind, price and test accounts", () => {
  const sql = read("../supabase/drafts/20261126000100_admin_approve_provider_with_service.sql");
  assert.match(sql, /role = 'admin'/);
  assert.match(sql, /is_test then raise/);
  assert.match(sql, /p_price < 0/);
  assert.match(sql, /revoke execute[^;]*from public, anon/);
  assert.match(sql, /search_path = ''/);
});
