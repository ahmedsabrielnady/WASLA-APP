-- wasla-test ONLY. Draft: merchant_add_product RPC, NOT a production migration.
-- Why: on the test project the authenticated role has no USAGE on products_id_seq, so the products_merchant_write
-- policy cannot be used for INSERT from the app (permission denied for sequence). Rather than granting sequence
-- access, this RPC inserts on the merchant's behalf with the same checks the policy uses. Requires draft 1200.
-- Updates (stock, active) keep using the existing products_merchant_write policy.
create or replace function public.merchant_add_product(p_name text, p_category text, p_price integer, p_stock integer)
returns table(out_id integer, out_category text)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_pid uuid; v_name text := trim(coalesce(p_name,''));
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  select p.id into v_pid from public.providers p join public.profiles pr on pr.id = p.user_id
   where p.user_id = v_uid and p.kind = 'merchant' and p.approved and p.active and not p.is_test and pr.role = 'merchant' limit 1;
  if v_pid is null then raise exception 'حساب التاجر غير معتمد' using errcode = '42501'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'اسم المنتج غير صالح' using errcode = '22023'; end if;
  if p_category is null or p_category not in ('market','food','supplies') then raise exception 'تصنيف غير صالح' using errcode = '22023'; end if;
  if p_price is null or p_price < 1 or p_price > 100000 then raise exception 'السعر غير صالح' using errcode = '22023'; end if;
  if p_stock is null or p_stock < 0 or p_stock > 10000 then raise exception 'المخزون غير صالح' using errcode = '22023'; end if;
  if (select count(*) from public.products where merchant_id = v_pid) >= 200 then raise exception 'وصلت للحد الأقصى للمنتجات' using errcode = '53400'; end if;
  return query insert into public.products (merchant_id, name, price_egp, stock, active, category)
    values (v_pid, v_name, p_price, p_stock, true, p_category) returning id, category;
end $function$;
revoke all on function public.merchant_add_product(text,text,integer,integer) from public, anon;
grant execute on function public.merchant_add_product(text,text,integer,integer) to authenticated;
