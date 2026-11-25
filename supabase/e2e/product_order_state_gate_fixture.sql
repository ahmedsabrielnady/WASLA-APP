-- wasla-test ONLY, bounded synthetic bracket for product_order_state_gate_test.py. Merchant provider of user 7 (id 5221b069-86f9-4f5a-9575-3e6fdf860582), product '[fixture] discount product 30/25'.
-- Snapshot (verified before use): kind=merchant, approved=true, active=true, is_test=false.
-- For each STATE in (approved=false | active=false | is_test=true): run  update public.providers set STATE where id=...;  run the test with 'refuse';  ALWAYS run OFF;  verify OFF returns off:merchant|true|true|false.
-- OFF (always, even when the test failed):
update public.providers set approved=true, active=true, is_test=false where id='5221b069-86f9-4f5a-9575-3e6fdf860582';
