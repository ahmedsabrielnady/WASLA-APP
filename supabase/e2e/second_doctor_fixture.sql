-- wasla-test ONLY. Fixture for emr_notes_rpc_only_test: provider 46bfa0b7 (user 3, technician, 0 schedule rows before) is temporarily a doctor
-- with a copy of doctor 5's schedule rows. ALWAYS run OFF after the test, even if the test fails. Not for production.
-- ===== ON =====
update public.providers set kind='doctor' where id='46bfa0b7-2501-4676-a724-e052603b7935' and kind='technician';
insert into public.provider_schedules (provider_id,weekday,start_time,end_time,slot_minutes,active)
select '46bfa0b7-2501-4676-a724-e052603b7935',weekday,start_time,end_time,slot_minutes,active from public.provider_schedules where provider_id=(select p.id from public.providers p join auth.users u on u.id=p.user_id where u.email='01000000005@wasla.app' and p.kind='doctor');
-- ===== OFF =====
delete from public.provider_schedules where provider_id='46bfa0b7-2501-4676-a724-e052603b7935';
update public.providers set kind='technician' where id='46bfa0b7-2501-4676-a724-e052603b7935' and kind='doctor';
-- verify: schedules=0, kind technician, approved=true, active=true, is_test=false
