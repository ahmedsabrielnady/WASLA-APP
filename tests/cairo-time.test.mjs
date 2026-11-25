import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { cairoLocalToDate } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const back = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }).format(d).replace(" ", "T");

test("datetime-local is read as Cairo wall-clock time and round-trips to the displayed Cairo time", () => {
  for (const v of ["2026-11-27T10:30", "2026-07-15T10:30", "2027-03-15T09:00", "2026-04-23T23:30", "2026-10-30T23:30"]) {
    const d = cairoLocalToDate(v);
    assert.equal(back(d), v, v);
  }
  // Offsets from the runtime time-zone data: winter +2, summer +3.
  assert.equal(cairoLocalToDate("2026-11-27T10:30").toISOString(), "2026-11-27T08:30:00.000Z");
  assert.equal(cairoLocalToDate("2026-07-15T10:30").toISOString(), "2026-07-15T07:30:00.000Z");
});

test("invalid input gives an invalid date, never a silent default", () => {
  for (const v of ["", null, "x", "2026-13-40T99:99x"]) assert.ok(Number.isNaN(cairoLocalToDate(v).getTime()));
});

test("a failed second step is shown as an error and tells the customer not to resend", () => {
  assert.match(main, /preferredTimeSaved === false/);
  assert.match(main, /الموعد المقترح ما اتحفظش\. متبعتش الطلب تاني/);
});
