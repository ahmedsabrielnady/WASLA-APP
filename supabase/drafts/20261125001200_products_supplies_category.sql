-- wasla-test ONLY. Draft: add a 'supplies' (medical supplies) product category next to 'market' and 'food'.
-- NOT a production migration. Requires drafts 0300 and 0400. Existing rows are unchanged.
-- Purchasing stays role-neutral; the merchant-kind, approval, active, non-test and own-product checks are kept.
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in ('market','food','supplies'));
alter table public.orders drop constraint if exists orders_product_category_check;
alter table public.orders add constraint orders_product_category_check check (product_category is null or product_category in ('market','food','supplies'));

create or replace function public.place_product_order(p_product integer, p_qty integer, p_address text, p_notes text default null, p_source text default 'web')
returns table(out_order_id uuid, out_ref text, out_total integer)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_p public.products%rowtype; v_total int; v_id uuid; v_ref text; v_recent int;
  v_src text := case when p_source in ('web','app') then p_source else 'web' end;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not (exists (select 1 from public.consents where user_id = v_uid and kind = 'terms')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'privacy')) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode = '42501'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then raise exception 'الكمية لازم تكون من 1 لـ 20' using errcode = '22023'; end if;
  if p_address is null or length(trim(p_address)) < 5 then raise exception 'العنوان مطلوب' using errcode = '22023'; end if;
  select count(*) into v_recent from public.orders where customer_id = v_uid and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode = '53400'; end if;
  select * into v_p from public.products where id = p_product for update;
  if not found or not v_p.active or v_p.category not in ('market','food','supplies') then raise exception 'المنتج ده مش متاح' using errcode = '22023'; end if;
  if not exists (select 1 from public.providers m where m.id = v_p.merchant_id and m.kind = 'merchant' and m.approved and m.active and not m.is_test) then
    raise exception 'المنتج ده مش متاح' using errcode = '22023'; end if;
  if exists (select 1 from public.providers m where m.id = v_p.merchant_id and m.user_id = v_uid) then
    raise exception 'لا يمكن طلب منتج من حسابك' using errcode = '42501'; end if;
  if v_p.stock < p_qty then raise exception 'الكمية المطلوبة مش متوفرة' using errcode = '22023'; end if;
  v_total := coalesce(v_p.discount_price_egp, v_p.price_egp) * p_qty;
  update public.products set stock = stock - p_qty where id = p_product;
  insert into public.orders (customer_id, provider_id, sector, item_id, product_id, product_category, quantity, address, notes, price_egp, deposit_egp, source)
  values (v_uid, v_p.merchant_id, 'store', null, p_product, v_p.category, p_qty, trim(p_address), nullif(trim(coalesce(p_notes,'')),''), v_total, 0, v_src)
  returning id, ref into v_id, v_ref;
  insert into public.order_events (order_id, actor_id, from_status, to_status, note) values (v_id, v_uid, null, 'new', 'تم استلام طلب المنتج');
  return query select v_id, v_ref, v_total;
end $function$;
