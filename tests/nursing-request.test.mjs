import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const drafts = new URL("../supabase/drafts/", import.meta.url);

test("draft 1500 keeps nursing closed by default and requires every consent and a covering provider", async () => {
  const name = (await readdir(drafts)).find((f) => f.includes("nursing_request"));
  const sql = await readFile(new URL(name, drafts), "utf8");
  assert.match(sql, /nursing_intake_open boolean not null default false/);
  for (const kind of ["terms", "privacy", "health_data"]) assert.match(sql, new RegExp(`kind = '${kind}'`));
  assert.match(sql, /sector = 'nursing' and active = true and nursing_intake_open = true/);
  assert.match(sql, /provider_service_coverage c join public\.providers pr/);
  assert.match(sql, /pr\.approved and pr\.active and not pr\.is_test/);
  assert.match(sql, /revoke all on function public\.request_nursing_visit\(integer,text,text,text\) from public, anon/);
  assert.doesNotMatch(sql, /update public\.service_items|insert into public\.service_items/);
});
