import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";

// Guard: SQL kept in supabase/drafts must never also sit in supabase/migrations,
// where an automatic migration run could apply it to production.
test("draft SQL files are not present in supabase/migrations", () => {
  const drafts = new URL("../supabase/drafts/", import.meta.url);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  if (!existsSync(drafts)) return;
  const draftSql = readdirSync(drafts).filter((name) => name.endsWith(".sql"));
  const migrationSql = new Set(readdirSync(migrations));
  for (const name of draftSql) assert.ok(!migrationSql.has(name), `${name} is a draft but also in migrations`);
  assert.ok(draftSql.length >= 1);
});
