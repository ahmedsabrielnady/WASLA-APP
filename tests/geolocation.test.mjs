import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { directionsLinks, isValidEgyptPhone, isValidPoint, normalizePlate, telHref, validateVehicle, TILE_URL, TILE_ATTRIBUTION } from "../src/geo.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("coordinates are validated", () => {
  assert.equal(isValidPoint(30.29, 31.31), true);
  for (const [a, b] of [[null, 1], [1, null], ["", 1], [91, 0], [0, 181], ["x", 1], [NaN, 1]]) assert.equal(isValidPoint(a, b), false);
});

test("directions links need no API key and are fixed-precision", () => {
  const l = directionsLinks(30.2897, 31.3167);
  assert.equal(l.google, "https://www.google.com/maps/dir/?api=1&destination=30.289700,31.316700");
  assert.match(l.osm, /^https:\/\/www\.openstreetmap\.org\/directions/);
  assert.match(l.geo, /^geo:30\.289700,31\.316700/);
  for (const v of Object.values(l)) assert.doesNotMatch(v, /key=/i);
  assert.equal(directionsLinks(null, 1), null);
});

test("call link only for Egyptian mobile numbers", () => {
  assert.equal(telHref("01012345678"), "tel:+201012345678");
  assert.equal(telHref("12345"), "");
  assert.equal(telHref("javascript:alert(1)"), "");
  assert.equal(isValidEgyptPhone("01012345678"), true);
  assert.equal(isValidEgyptPhone("0101234567"), false);
});

test("vehicle details are required for car orders", () => {
  assert.notEqual(validateVehicle({}), "");
  assert.notEqual(validateVehicle({ make: "Toyota", model: "", plate: "ABC 123" }), "");
  assert.equal(validateVehicle({ make: "Toyota", model: "Corolla", plate: " abc  123 " }), "");
  assert.equal(normalizePlate(" abc  123 "), "ABC 123");
});

test("OSM tiles: https, attribution present, no paid provider and no key", () => {
  assert.equal(TILE_URL, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.match(TILE_ATTRIBUTION, /OpenStreetMap/);
  assert.match(TILE_ATTRIBUTION, /copyright/);
  assert.doesNotMatch(read("../src/geo.js") + read("../index.html"), /mapbox|googleapis\.com\/maps\/api|nominatim|api[_-]?key/i);
  assert.doesNotMatch(read("../index.html"), /referrer/i);
});

test("the app no longer reads or writes coordinates on orders", () => {
  const sb = read("../src/supabase.js");
  const main = read("../src/main.js");
  assert.doesNotMatch(sb, /scheduled_at,lat,lng/);
  assert.doesNotMatch(sb, /set_order_location/);
  assert.doesNotMatch(main, /order\.lat|order\.lng/);
  assert.match(sb, /save_order_location/);
  assert.match(sb, /provider_get_order_location/);
});

test("location is saved only with explicit consent and the draft enforces it", () => {
  const main = read("../src/main.js");
  assert.match(main, /وافق على مشاركة موقعك/);
  const sql = read("../supabase/drafts/20261126000000_order_locations.sql");
  assert.match(sql, /p_consent is not true/);
  assert.match(sql, /orders_strip_coordinates/);
  assert.match(sql, /revoke execute on function public\.set_order_location/);
  assert.match(sql, /purge_expired_locations/);
  assert.doesNotMatch(sql, /grant execute on function public\.purge_expired_locations[^;]*authenticated/);
  for (const fn of sql.match(/create or replace function public\.\w+[^$]*?security definer set search_path = ''/gs) || []) assert.match(fn, /search_path = ''/);
});

test("Leaflet is vendored, not loaded from a CDN", () => {
  const geo = read("../src/geo.js");
  assert.match(geo, /\.\/vendor\/leaflet\/leaflet\.js/);
  assert.doesNotMatch(geo, /unpkg|cdn\./);
});
