-- wasla-test ONLY. Bounded fixture for delivery_consent_access_test + delivery_idempotency_test. Exception-safe order: run ON, run tests, ALWAYS run OFF, compare the OFF output with the snapshot taken before ON.
-- Snapshot (user 1 consents, 6 rows, ids 12,13,16,17,50,51) is embedded in OFF. Re-take it before reuse: select json_agg(c order by c.id) from public.consents c where c.user_id=<user 1 id>;
-- ===== ON =====
delete from public.consents where user_id='13ae1408-0400-4aea-a07f-c7edbd21590c';
update public.providers set kind='courier' where id='46bfa0b7-2501-4676-a724-e052603b7935' and kind='technician';
select (select count(*) from public.consents where user_id='13ae1408-0400-4aea-a07f-c7edbd21590c')||' consents, provider kind '||(select kind from public.providers where id='46bfa0b7-2501-4676-a724-e052603b7935') as v;
-- ===== OFF =====
delete from public.consents where user_id='13ae1408-0400-4aea-a07f-c7edbd21590c';
insert into public.consents (id,user_id,kind,version,accepted_at) overriding system value values
(12,'13ae1408-0400-4aea-a07f-c7edbd21590c','terms','test','2026-11-24T22:31:41.435716+00:00'),
(13,'13ae1408-0400-4aea-a07f-c7edbd21590c','privacy','test','2026-11-24T22:31:41.589094+00:00'),
(16,'13ae1408-0400-4aea-a07f-c7edbd21590c','terms','draft-2026-11-24.2','2026-11-24T22:32:33.633223+00:00'),
(17,'13ae1408-0400-4aea-a07f-c7edbd21590c','privacy','draft-2026-11-24.2','2026-11-24T22:32:33.788453+00:00'),
(50,'13ae1408-0400-4aea-a07f-c7edbd21590c','terms','2026-11','2026-11-25T02:23:03.191089+00:00'),
(51,'13ae1408-0400-4aea-a07f-c7edbd21590c','privacy','2026-11','2026-11-25T02:23:03.459282+00:00');
update public.providers set kind='technician' where id='46bfa0b7-2501-4676-a724-e052603b7935' and kind='courier';
select (select json_agg(c order by c.id)::text from public.consents c where c.user_id='13ae1408-0400-4aea-a07f-c7edbd21590c') as v
union all select 'provider '||kind||' approved='||approved||' active='||active||' test='||is_test from public.providers where id='46bfa0b7-2501-4676-a724-e052603b7935';
