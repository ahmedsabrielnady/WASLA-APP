-- DRAFT, not applied to production. Adds the one maintenance item from the original requirement that the catalogue lacks: carpenter.
-- (Home cleaning and pest control already exist in service_items with prices and public_orderable = false; they are not touched here.)
-- Idempotent. Price is intentionally null (quoted by staff after inspection); the production price is the owner's decision.
-- public_orderable stays false until the owner approves the wording and price, and a provider is covered via admin_set_provider_service_coverage.
insert into public.service_items(sector, name, price_egp, active, public_orderable)
select 'maintenance', v.name, null, true, false
from (values
  ('نجار (يتحدد السعر بعد الكشف)')
) as v(name)
where not exists (select 1 from public.service_items s where s.sector = 'maintenance' and s.name = v.name);
