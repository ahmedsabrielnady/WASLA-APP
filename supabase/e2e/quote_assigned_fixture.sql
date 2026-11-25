-- wasla-test ONLY, bounded synthetic bracket for quote_assigned_provider_denial_test.py <order>. Order ff7af7bb-2124-4f42-8264-e9e074842ad6 (clinic, cancelled, synthetic, customer user 1).
-- Snapshot (verified): status=cancelled, provider_id=29a44c36-1065-41a3-b0be-7f7f28feb4c4, quote_price_egp null, quote_version 0 (NOT NULL column), price_egp 150.
-- ON:
-- update public.orders set status='quoted', provider_id='46bfa0b7-2501-4676-a724-e052603b7935', quote_price_egp=150, quote_version=1 where id='ff7af7bb-2124-4f42-8264-e9e074842ad6' and status='cancelled' and provider_id='29a44c36-1065-41a3-b0be-7f7f28feb4c4';
-- run the test, then ALWAYS OFF:
update public.orders set status='cancelled', provider_id='29a44c36-1065-41a3-b0be-7f7f28feb4c4', quote_price_egp=null, quote_version=0 where id='ff7af7bb-2124-4f42-8264-e9e074842ad6';
-- verify: off:cancelled|29a44c36-...|-|0|150. Side effect: updated_at changes and the orders triggers may write synthetic notification rows; these are not restored.
