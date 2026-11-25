import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { cairoLocalToDate, resolveCairoLocal, cairoLocalProblem } = await import("../src/supabase.js");
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

test("nonexistent and ambiguous Cairo wall times are rejected, never shifted", () => {
  // Scan the DST transition weeks for wall times that are skipped or repeated, using the runtime zone data.
  const found = { gap: [], ambiguous: [] };
  for (const [y, mo] of [[2026, 4], [2026, 10], [2027, 4], [2027, 10]]) {
    for (let d = 20; d <= 31; d += 1) {
      for (let h = 0; h < 24; h += 1) {
        const v = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:30`;
        const r = resolveCairoLocal(v);
        if (r.status === "gap") found.gap.push(v);
        if (r.status === "ambiguous") found.ambiguous.push(v);
      }
    }
  }
  assert.ok(found.gap.length >= 1, "spring gap found in the data");
  assert.ok(found.ambiguous.length >= 1, "autumn repeat found in the data");
  for (const v of [...found.gap, ...found.ambiguous]) {
    assert.ok(Number.isNaN(cairoLocalToDate(v).getTime()), v);
    assert.match(cairoLocalProblem(v), /تغيير الساعة/);
  }
  // Ordinary neighbours still resolve.
  assert.equal(resolveCairoLocal("2026-12-10T10:30").status, "ok");
});

test("a bad or too-soon time is refused before any order is created", () => {
  const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
  const pre = api.indexOf("cairoLocalProblem(preferredAt)");
  const rpc = api.indexOf("/rest/v1/rpc/request_nursing_visit");
  assert.ok(pre > 0 && rpc > 0 && pre < rpc);
  assert.match(cairoLocalProblem("2020-01-01T10:30"), /ساعة/);
});

test("time-only retry exists and the request form is hidden while an order awaits its time", () => {
  assert.match(main, /data-form="nursing-time-retry"/);
  assert.match(main, /state\.nursingTimeRetry = \{ orderId: sent\.out_order_id/);
  assert.match(main, /<form data-form="nursing-request" novalidate \$\{state\.nursingTimeRetry \? 'hidden/);
  assert.match(main, /nursing-time-skip/);
});
