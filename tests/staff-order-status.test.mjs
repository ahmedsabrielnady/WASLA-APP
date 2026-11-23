import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supabaseSource = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/live-patches/20261123_staff_order_status_v2_rpc.sql", import.meta.url),
  "utf8"
);

test("staff order status updates use the guarded v2 RPC", () => {
  assert.match(supabaseSource, /\/rest\/v1\/rpc\/staff_set_order_status_v2/);
  assert.doesNotMatch(supabaseSource, /\/rest\/v1\/rpc\/set_order_status["']/);
});

test("staff status RPC enforces role and private transition matrix", () => {
  assert.match(migration, /public\.is_staff\(\)/);
  assert.match(migration, /public\.order_status_transitions/);
  assert.match(migration, /t\.actor_scope = 'staff'/);
  assert.match(migration, /for update/i);
  assert.match(migration, /insert into public\.order_events/i);
});

test("staff cannot start or finish work without an approved active non-test provider", () => {
  assert.match(migration, /p_to in \('in_progress', 'done'\)/);
  assert.match(migration, /p\.approved = true/);
  assert.match(migration, /p\.active = true/);
  assert.match(migration, /p\.is_test = false/);
});

test("staff status RPC is not executable by public or anonymous users", () => {
  assert.match(migration, /revoke all on function public\.staff_set_order_status_v2\(uuid, text, text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.staff_set_order_status_v2\(uuid, text, text\) to authenticated, service_role/i);
});
