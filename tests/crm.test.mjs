import test from "node:test";
import assert from "node:assert/strict";
import { renderCrmView } from "../src/crm.js";

const base = {
  profile: { role: "staff" },
  metrics: {
    total_customers: 12,
    active_30d: 4,
    new_month: 3,
    never_ordered: 5,
    repeat_customers: 2,
    total_orders: 17,
    new_orders: 5,
    open_orders: 0,
    completed_orders: 12,
    cancelled_orders: 0,
    open_tickets: 0,
    collected_revenue_egp: null
  },
  customers: [],
  providers: [],
  leads: [],
  tasks: [],
  tickets: [],
  customer360: null,
  preview: true,
  saving: false
};

test("CRM denies access to customer accounts", () => {
  const html = renderCrmView({ ...base, profile: { role: "customer" } });
  assert.match(html, /غير مصرح/);
  assert.doesNotMatch(html, /data-form="crm-lead"/);
});

test("CRM renders live metrics and never invents collected revenue", () => {
  const html = renderCrmView(base);
  assert.match(html, /إجمالي العملاء/);
  assert.match(html, /الإيرادات المحصلة/);
  assert.match(html, /غير متاح بعد/);
  assert.doesNotMatch(html, /الإيرادات المحصلة<\/span><strong>0/);
});

test("CRM escapes customer-controlled text before rendering markup", () => {
  const html = renderCrmView({
    ...base,
    customers: [{
      id: "customer-1",
      full_name: '<img src=x onerror="alert(1)">',
      phone: "01012345678",
      created_at: "2026-11-20T10:00:00Z"
    }]
  });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("CRM preview disables lead, task and ticket writes", () => {
  const html = renderCrmView(base);
  assert.match(html, /data-form="crm-lead"[\s\S]*?disabled/);
  assert.match(html, /data-form="crm-task"[\s\S]*?disabled/);
  assert.match(html, /data-form="crm-ticket"[\s\S]*?disabled/);
});

test("provider CRM escapes provider-controlled names", () => {
  const html = renderCrmView({
    ...base,
    providers: [{
      id: "provider-1",
      display_name: "<svg onload=alert(1)>",
      specialty: "صيانة",
      approved: true,
      active: true,
      is_test: false
    }]
  });
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /<svg onload/);
});
