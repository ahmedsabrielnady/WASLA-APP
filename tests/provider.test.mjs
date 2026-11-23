import test from "node:test";
import assert from "node:assert/strict";
import { renderProviderView } from "../src/provider.js";

const provider = {
  id: "provider-1",
  kind: "technician",
  display_name: "فني وصلة",
  specialty: "صيانة",
  approved: true,
  active: true,
  is_test: false
};

test("provider workspace denies customer roles", () => {
  const html = renderProviderView({ profile: { role: "customer" }, provider, orders: [] });
  assert.match(html, /غير مصرح/);
  assert.doesNotMatch(html, /provider-set-status/);
});

test("provider workspace shows pending approval without exposing orders", () => {
  const html = renderProviderView({
    profile: { role: "technician" },
    provider: { ...provider, approved: false },
    orders: [{ id: "secret-order", ref: "WSL-1", status: "confirmed" }]
  });
  assert.match(html, /بانتظار مراجعة الإدارة/);
  assert.doesNotMatch(html, /WSL-1/);
});

test("provider workspace renders only assigned work and escapes database text", () => {
  const html = renderProviderView({
    profile: { role: "technician" },
    provider,
    orders: [{
      id: "order-1",
      ref: "WSL-123",
      sector: "maintenance",
      status: "confirmed",
      address: '<img src=x onerror="alert(1)">',
      notes: "افحص <script>",
      price_egp: 250,
      created_at: "2026-11-23T10:00:00Z"
    }]
  });
  assert.match(html, /WSL-123/);
  assert.match(html, /data-status="in_progress"/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
});

test("provider preview cannot update order status", () => {
  const html = renderProviderView({
    profile: { role: "technician" },
    provider,
    preview: true,
    orders: [{ id: "order-1", ref: "WSL-123", sector: "maintenance", status: "confirmed" }]
  });
  assert.match(html, /data-action="provider-set-status"[^>]*disabled/);
});
