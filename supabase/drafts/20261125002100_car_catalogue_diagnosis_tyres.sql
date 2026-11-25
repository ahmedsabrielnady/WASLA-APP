-- DRAFT, not applied to production. Adds two car catalogue items from the original requirement: fault diagnosis and tyres.
-- Idempotent. Prices are intentionally null (quoted by staff after inspection); production prices are the owner's decision.
-- public_orderable stays false until the owner approves the wording and prices, and a provider is covered via admin_set_provider_service_coverage.
insert into public.service_items(sector, name, price_egp, active, public_orderable)
select 'car', v.name, null, true, false
from (values
  ('فحص وتشخيص أعطال السيارة (يتحدد السعر بعد الكشف)'),
  ('إطارات: فحص وتغيير (يتحدد السعر بعد الكشف)')
) as v(name)
where not exists (select 1 from public.service_items s where s.sector = 'car' and s.name = v.name);
