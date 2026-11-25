-- wasla-test ONLY, bounded synthetic fixture: one persistent discounted product for store_order_rpc_test (server-side discount pricing).
-- ON is idempotent: creates the product (price 30, discount 25, stock 10000) for the provider of user 7 if missing.
-- OFF retires it. Orders reference it, so it is deactivated, never deleted.
-- ON
insert into public.products (merchant_id,name,price_egp,discount_price_egp,stock,active,category)
select '5221b069-86f9-4f5a-9575-3e6fdf860582','[fixture] discount product 30/25',30,25,10000,true,'market'
where not exists (select 1 from public.products where name='[fixture] discount product 30/25');
-- OFF
-- update public.products set active=false where name='[fixture] discount product 30/25';
