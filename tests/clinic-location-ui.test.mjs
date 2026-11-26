import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderProviderView } from "../src/provider.js";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const doctor = { id: "d1", approved: true, active: true, kind: "doctor", display_name: "د. تجربة", specialty: "باطنة" };
const base = { profile: { role: "doctor" }, provider: doctor, orders: [] };

test("doctor sees the clinic location card with map, address and save", () => {
  const html = renderProviderView({ ...base, clinicDraft: { lat: 30.29, lng: 31.31, address: "شارع التحرير", saved: true } });
  assert.match(html, /data-clinic-picker/);
  assert.match(html, /value="شارع التحرير"/);
  assert.match(html, /data-action="clinic-save-location"/);
  assert.match(html, /data-action="clinic-use-gps"/);
});

test("non-doctor providers do not get the clinic card", () => {
  const html = renderProviderView({ ...base, provider: { ...doctor, kind: "technician" } });
  assert.doesNotMatch(html, /data-clinic-location/);
});

test("buttons are disabled in preview", () => {
  const html = renderProviderView({ ...base, preview: true, clinicDraft: { lat: 30, lng: 31, address: "", saved: false } });
  assert.match(html, /data-action="clinic-save-location" disabled/);
});

test("customer clinic booking shows the selected doctor's location with directions", () => {
  const main = read("../src/main.js");
  assert.match(main, /clinicLocationInfo\(state\.clinicDoctorId\)/);
  assert.match(main, /data-clinic-info/);
  assert.match(main, /directionsLinks\(loc\.lat, loc\.lng\)/);
});

test("clinic location write is the RPC only and validates input", () => {
  const api = read("../src/supabase.js");
  assert.match(api, /rpc\/provider_set_clinic_location/);
  const main = read("../src/main.js");
  assert.match(main, /address\.length < 4/);
  assert.match(main, /isValidPoint\(draft\.lat, draft\.lng\)/);
});
