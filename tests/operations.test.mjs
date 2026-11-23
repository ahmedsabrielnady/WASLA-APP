import test from "node:test";
import assert from "node:assert/strict";
import { renderOperationsView } from "../src/operations.js";

const services = [
  { id: 4, sector: "maintenance", name: "كشف سباك", price_egp: 50, active: true, public_orderable: true },
  { id: 8, sector: "car", name: "غسيل السيارة في مكانك", price_egp: 150, active: true, public_orderable: false }
];

test("founder sees service price controls and orderability status", () => {
  const html = renderOperationsView({
    profile: { role: "admin" },
    services,
    orders: [],
    providers: [],
    preview: false,
    saving: false
  });

  assert.match(html, /أسعار الخدمات/);
  assert.match(html, /operations-service-price/);
  assert.match(html, /كشف سباك/);
  assert.match(html, /مسموح بالطلب/);
  assert.match(html, /غير متاح للطلب/);
});

test("staff does not see founder-only service price controls", () => {
  const html = renderOperationsView({
    profile: { role: "staff" },
    services,
    orders: [],
    providers: [],
    preview: false,
    saving: false
  });

  assert.doesNotMatch(html, /أسعار الخدمات/);
  assert.doesNotMatch(html, /operations-service-price/);
});

test("preview founder sees disabled service price controls", () => {
  const html = renderOperationsView({
    profile: { role: "admin" },
    services,
    orders: [],
    providers: [],
    preview: true,
    saving: false
  });

  assert.match(html, /operations-service-price/);
  assert.match(html, /disabled/);
});


test("staff and admin can generate provider invites, and the latest code is visible", () => {
  for (const role of ["staff", "admin"]) {
    const html = renderOperationsView({
      profile: { role },
      orders: [],
      providers: [],
      services: [],
      latestInviteCode: "WASLA-TEST-123",
      preview: false,
      saving: false
    });
    assert.match(html, /operations-invite/);
    assert.match(html, /WASLA-TEST-123/);
  }
});

test("provider invite creation is disabled in previews", () => {
  const html = renderOperationsView({
    profile: { role: "staff" },
    orders: [],
    providers: [],
    services: [],
    preview: true,
    saving: false
  });
  assert.match(html, /operations-invite/);
  assert.match(html, /disabled/);
});


test("founder can manage provider-to-service coverage, while staff cannot", () => {
  const providers = [{
    id: "provider-1",
    display_name: "محمد الفني",
    kind: "technician",
    specialty: "كهرباء وسباكة",
    approved: true,
    active: true,
    is_test: false
  }];
  const services = [{
    id: 4,
    sector: "maintenance",
    name: "كشف سباك",
    active: true,
    public_orderable: true
  }];
  const coverage = [{
    id: "coverage-1",
    provider_id: "provider-1",
    service_item_id: 4,
    active: true
  }];
  const adminHtml = renderOperationsView({
    profile: { role: "admin" },
    providers,
    services,
    coverage,
    orders: [],
    preview: false,
    saving: false
  });
  const staffHtml = renderOperationsView({
    profile: { role: "staff" },
    providers,
    services,
    coverage,
    orders: [],
    preview: false,
    saving: false
  });

  assert.match(adminHtml, /ربط مقدم الخدمة بالخدمات/);
  assert.match(adminHtml, /operations-provider-coverage/);
  assert.match(adminHtml, /مغطاة وقابلة للطلب/);
  assert.doesNotMatch(staffHtml, /ربط مقدم الخدمة بالخدمات/);
  assert.doesNotMatch(staffHtml, /operations-provider-coverage/);
});

test("provider coverage controls are disabled in previews", () => {
  const html = renderOperationsView({
    profile: { role: "admin" },
    providers: [{ id: "provider-1", display_name: "فني", kind: "technician", approved: true, active: true, is_test: false }],
    services: [{ id: 4, sector: "maintenance", name: "كشف سباك", active: true, public_orderable: true }],
    coverage: [],
    orders: [],
    preview: true,
    saving: false
  });
  assert.match(html, /operations-provider-coverage/);
  assert.match(html, /disabled/);
});
