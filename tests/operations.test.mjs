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
