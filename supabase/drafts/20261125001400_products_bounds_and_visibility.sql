-- wasla-test ONLY. Draft: product integrity and visibility, NOT a production migration. Requires drafts 0300, 1200, 1300.
-- 1. Bounds: price 1..100000, stock 0..10000, discount between 1 and the price. The merchant_add_product RPC already
--    enforces this; direct updates and inserts were not bounded (price 0, 2000000000 and stock 100000000 were accepted).
-- 2. Creation goes through merchant_add_product only: INSERT is revoked from authenticated (the app never inserts directly,
--    and direct inserts bypassed the RPC bounds and the 200-product cap). Staff can still insert from the dashboard.
--    Updates (stock, active, name, price, category) keep using products_merchant_write.
-- 3. Visibility matches purchasability: a product is shown to customers and anon only while its merchant is an approved,
--    active, non-test merchant provider, the same condition place_product_order enforces. Before this, a product of a
--    deactivated merchant, or one owned by a technician, doctor or teacher provider, was listed but could not be bought.
-- Existing rows were validated against the bounds before the constraint was enabled on wasla-test. Check production first.
alter table public.products drop constraint if exists products_bounds_check;
alter table public.products add constraint products_bounds_check check (price_egp between 1 and 100000 and stock between 0 and 10000 and (discount_price_egp is null or (discount_price_egp >= 1 and discount_price_egp <= price_egp))) not valid;
alter table public.products validate constraint products_bounds_check;
revoke insert on public.products from authenticated;
create or replace function public.merchant_is_sellable(p_merchant uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.providers m where m.id = p_merchant and m.kind = 'merchant' and m.approved and m.active and not m.is_test) $$;
grant execute on function public.merchant_is_sellable(uuid) to anon, authenticated;
drop policy if exists products_authenticated_read on public.products;
create policy products_authenticated_read on public.products for select to authenticated
  using ((active = true and stock > 0 and public.merchant_is_sellable(merchant_id)) or merchant_id = current_provider_id() or is_staff());
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select to anon
  using (active = true and stock > 0 and public.merchant_is_sellable(merchant_id));
