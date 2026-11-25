import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002100_car_catalogue_diagnosis_tyres.sql", import.meta.url), "utf8");

test("car catalogue draft is idempotent, unpriced and not publicly orderable", () => {
  assert.match(sql, /where not exists/);
  assert.match(sql, /select 'car', v\.name, null, true, false/);
  assert.match(sql, /فحص وتشخيص أعطال السيارة/);
  assert.match(sql, /إطارات/);
  assert.doesNotMatch(sql, /\d+\s*,\s*true\s*,\s*true/);
});
