import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/drafts/20261125002300_notification_sources.sql", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("every new notification kind has a trigger, a constraint entry and a generic page text", () => {
  for (const kind of ["delivery_status", "prescription_quote", "session_cancelled", "session_link"]) {
    assert.match(sql, new RegExp(`'${kind}'`));
    assert.match(main, new RegExp(`${kind}: "`));
  }
  assert.equal((sql.match(/create trigger/g) || []).length, 4);
});

test("notification rows are written with a kind and a reference only, never a price, note, address or name", () => {
  const inserts = sql.match(/insert into public\.notifications\([^)]*\)/g) || [];
  assert.equal(inserts.length, 4);
  for (const text of inserts) assert.equal(text, "insert into public.notifications(user_id, kind, ref_id)");
});

test("new-kind page texts carry no health, price or name detail", () => {
  const block = main.slice(main.indexOf("delivery_status:"), main.indexOf("};", main.indexOf("delivery_status:")));
  assert.doesNotMatch(block, /روشتة|دواء|جنيه|سعر|صيدلية|تحليل/);
});
