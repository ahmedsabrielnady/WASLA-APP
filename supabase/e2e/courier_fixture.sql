-- wasla-test ONLY, bounded synthetic fixture for the delivery tests (notification_delivery_e2e_test, delivery_rpc_test).
-- They need one provider of kind 'courier' that belongs to user 3. wasla-test has none, so the existing provider of user 3 (technician "Test Plumber")
-- is switched for the duration of the run and switched back. Run the ON block, run the tests with WASLA_TEST_PROVIDER_ID=<that provider id>, then run the OFF block.
-- Technician tests that use user 3 must not run while it is ON.
-- Look up the id first:  select id, kind from public.providers where user_id = (select id from auth.users where email = '010000000003@wasla.app');
-- ON
update public.providers set kind='courier' where id = :provider_id and kind='technician';
-- OFF (verify the result shows technician, approved=true, active=true, is_test=false as before)
update public.providers set kind='technician' where id = :provider_id and kind='courier';
