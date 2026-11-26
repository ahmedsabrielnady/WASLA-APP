import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const main = read("../src/main.js");
const api = read("../src/supabase.js");
const geo = read("../src/geo.js");

test("customer delivery form offers optional pins behind explicit consent", () => {
  assert.match(main, /name="share_locations" data-delivery-share/);
  assert.match(main, /data-delivery-picker="pickup"/);
  assert.match(main, /data-delivery-picker="dropoff"/);
  assert.match(main, /saveDeliveryLocations\([\s\S]{0,160}, true\)/);
  assert.match(main, /state\.deliveryPins\.share && state\.deliveryPins\.pickup && state\.deliveryPins\.dropoff/);
});

test("location save failure never loses the delivery request", () => {
  assert.match(main, /pinsSaved = false/);
  assert.match(main, /لكن تعذر حفظ الموقع على الخريطة/);
});

test("courier and staff open the route through the guarded RPC only", () => {
  assert.match(main, /role === "courier" \|\| role === "staff"/);
  assert.match(main, /data-action="delivery-map"/);
  assert.match(api, /rpc\/courier_get_delivery_locations/);
  assert.match(api, /rpc\/save_delivery_locations/);
  assert.doesNotMatch(api, /rest\/v1\/delivery_request_locations/);
});

test("route map draws both markers and directions links", () => {
  assert.match(geo, /export async function mountRouteMap/);
  assert.match(geo, /fitBounds/);
  assert.match(main, /اتجاهات للاستلام/);
  assert.match(main, /اتجاهات للتسليم/);
});
