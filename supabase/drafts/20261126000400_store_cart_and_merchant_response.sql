-- Store cart checkout and merchant accept/reject. DRAFT for TEST first; production only after an approved plan.
alter table public.orders add column if not exists cart_id uuid;
create index if not exists orders_cart_id_idx on public.orders (cart_id) where cart_id is not null;

create or replace function public.place_cart_order(p_lines jsonb, p_address text, p_notes text default null, p_source text default 'web')
returns table(out_cart uuid, out_order_id uuid, out_ref text, out_merchant uuid, out_total integer)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_cart uuid := gen_random_uuid(); v_recent int; v_n int; r record; v_p public.products%rowtype; v_total int; v_id uuid; v_ref text;
  v_src text := case when p_source in ('web','app') then p_source else 'web' end;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not (exists (select 1 from public.consents where user_id = v_uid and kind = 'terms')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'privacy')) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode = '42501'; end if;
  if p_address is null or length(trim(p_address)) < 5 then raise exception 'العنوان مطلوب' using errcode = '22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'السلة غير صالحة' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_lines);
  if v_n < 1 or v_n > 10 then raise exception 'السلة من 1 إلى 10 أصناف' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'product') <> 'number' or jsonb_typeof(e->'qty') <> 'number'
                or (e->>'product') !~ '^[0-9]{1,9}$' or (e->>'qty') !~ '^[0-9]{1,3}$') then
    raise exception 'السلة غير صالحة' using errcode = '22023'; end if;
  -- one section per cart: market, food and medical supplies never mix in a single checkout
  if (select count(distinct pr.category) from public.products pr where pr.id in (select (e->>'product')::int from jsonb_array_elements(p_lines) e)) > 1 then
    raise exception 'السلة لازم تكون من قسم واحد' using errcode = '22023'; end if;
  select count(*) into v_recent from public.orders where customer_id = v_uid and created_at > now() - interval '10 minutes';
  if v_recent + v_n > 20 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode = '53400'; end if;
  -- one row per product, locked in product-id order so two carts cannot deadlock; any error rolls back every line
  for r in select (e->>'product')::int as pid, sum((e->>'qty')::int)::int as qty
           from jsonb_array_elements(p_lines) e group by 1 order by 1 loop
    if r.qty < 1 or r.qty > 20 then raise exception 'الكمية لازم تكون من 1 لـ 20' using errcode = '22023'; end if;
    select * into v_p from public.products where id = r.pid for update;
    if not found or not v_p.active or v_p.category not in ('market','food','supplies') then raise exception 'منتج في السلة مش متاح' using errcode = '22023'; end if;
    if not exists (select 1 from public.providers m where m.id = v_p.merchant_id and m.kind = 'merchant' and m.approved and m.active and not m.is_test) then
      raise exception 'منتج في السلة مش متاح' using errcode = '22023'; end if;
    if exists (select 1 from public.providers m where m.id = v_p.merchant_id and m.user_id = v_uid) then
      raise exception 'لا يمكن طلب منتج من حسابك' using errcode = '42501'; end if;
    if v_p.stock < r.qty then raise exception 'الكمية المطلوبة من % مش متوفرة', v_p.name using errcode = '22023'; end if;
    v_total := coalesce(v_p.discount_price_egp, v_p.price_egp) * r.qty;
    update public.products set stock = stock - r.qty where id = r.pid;
    insert into public.orders (customer_id, provider_id, sector, item_id, product_id, product_category, quantity, address, notes, price_egp, deposit_egp, source, cart_id)
    values (v_uid, v_p.merchant_id, 'store', null, r.pid, v_p.category, r.qty, trim(p_address), nullif(trim(coalesce(p_notes,'')),''), v_total, 0, v_src, v_cart)
    returning id, ref into v_id, v_ref;
    insert into public.order_events (order_id, actor_id, from_status, to_status, note) values (v_id, v_uid, null, 'new', 'تم استلام طلب المنتج (سلة)');
    out_cart := v_cart; out_order_id := v_id; out_ref := v_ref; out_merchant := v_p.merchant_id; out_total := v_total;
    return next;
  end loop;
end $function$;

create or replace function public.merchant_respond_store_order(p_order uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := (select auth.uid()); v_pid uuid; v_o public.orders%rowtype; v_to text;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode = '42501'; end if;
  if p_accept is null then raise exception 'القرار مطلوب' using errcode = '22023'; end if;
  select id into v_pid from public.providers where user_id = v_uid and kind = 'merchant' and approved and active and not is_test;
  if v_pid is null then raise exception 'مقدم الخدمة غير معتمد أو غير نشط' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'الطلب غير موجود' using errcode = 'P0002'; end if;
  if v_o.provider_id is distinct from v_pid then raise exception 'الطلب غير مسند إليك' using errcode = '42501'; end if;
  if v_o.sector <> 'store' or v_o.product_id is null then raise exception 'هذا ليس طلب متجر' using errcode = '22023'; end if;
  if v_o.status <> 'new' then raise exception 'الطلب لم يعد جديدًا' using errcode = '42501'; end if;
  v_to := case when p_accept then 'confirmed' else 'cancelled' end;
  update public.orders set status = v_to, updated_at = pg_catalog.now() where id = p_order;
  insert into public.order_events (order_id, actor_id, from_status, to_status, note)
  values (p_order, v_uid, 'new', v_to, coalesce(nullif(trim(p_note), ''), case when p_accept then 'قبل التاجر الطلب' else 'رفض التاجر الطلب' end));
end $function$;

revoke execute on function public.place_cart_order(jsonb,text,text,text) from public, anon;
revoke execute on function public.merchant_respond_store_order(uuid,boolean,text) from public, anon;
grant execute on function public.place_cart_order(jsonb,text,text,text) to authenticated;
grant execute on function public.merchant_respond_store_order(uuid,boolean,text) to authenticated;
