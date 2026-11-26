import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderOperationsView } from "../src/operations.js";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const admin = { role: "admin" };
const offers = [
  { id: 1, text: "عرض الصيانة", sector: "maintenance", active: true, sort_order: 1 },
  { id: 2, text: "عرض متوقف", sector: "", active: false, sort_order: 2 }
];

test("founder sees an editor per offer plus a new-offer form", () => {
  const html = renderOperationsView({ profile: admin, offers });
  assert.equal((html.match(/data-form="save-offer"/g) || []).length, 3);
  assert.match(html, /data-offer-id="1"/);
  assert.match(html, /<option value="maintenance" selected>/);
  assert.match(html, /is-off/);
});

test("staff (non founder) does not get offer controls", () => {
  assert.doesNotMatch(renderOperationsView({ profile: { role: "staff" }, offers }), /save-offer/);
});

test("offer controls are disabled in preview", () => {
  assert.match(renderOperationsView({ profile: admin, offers, preview: true }), /type="submit" disabled/);
});

test("banner offers with a section are tappable and open that section", () => {
  const main = read("../src/main.js");
  assert.match(main, /data-action="offer" data-offer-id/);
  assert.match(main, /action === "sector" \|\| action === "offer"/);
  assert.match(main, /state\.activeOffer/);
  assert.match(main, /class="sector-offer"/);
});

test("offers read exposes the section and the write is RPC only", () => {
  const api = read("../src/supabase.js");
  assert.match(api, /select: "id,text,sort_order,sector"/);
  assert.match(api, /rpc\/admin_save_offer/);
  const sql = read("../supabase/drafts/20261126000200_offers_banner_control.sql");
  assert.match(sql, /role = 'admin'/);
  assert.match(sql, /revoke all on function public\.admin_save_offer/);
});
