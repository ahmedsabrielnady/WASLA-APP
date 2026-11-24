-- wasla-test ONLY. Draft: split products into market and food (restaurants) so both journeys reuse place_product_order.
-- NOT a production migration. Default keeps every existing product in the market category.
alter table public.products add column if not exists category text not null default 'market';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_category_check') then
    alter table public.products add constraint products_category_check check (category in ('market','food'));
  end if;
end $$;
