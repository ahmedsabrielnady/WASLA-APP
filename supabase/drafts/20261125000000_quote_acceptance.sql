-- Quote acceptance with versioning. NOT applied to production; apply deliberately at a production step. Tested on the isolated wasla-test project only.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid='public.orders'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%in_progress%' loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
  alter table public.orders add constraint orders_status_check check (status in ('new','quoted','confirmed','in_progress','done','cancelled'));
end $$;
alter table public.orders add column if not exists quote_price_egp int check (quote_price_egp is null or quote_price_egp between 0 and 10000000);
alter table public.orders add column if not exists quote_version int not null default 0;

create or replace function public.quote_order_v3(p_order uuid, p_price int)
returns int language plpgsql security definer set search_path = '' as $$
declare v public.orders%rowtype; v_new int;
begin
  if not coalesce(public.is_staff(),false) then raise exception 'غير مصرح بإرسال عرض السعر' using errcode='42501'; end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then raise exception 'السعر غير صالح' using errcode='22023'; end if;
  select * into v from public.orders where id=p_order for update;
  if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;
  if v.status not in ('new','quoted') then raise exception 'لا يمكن تعديل السعر بعد تأكيد الطلب' using errcode='42501'; end if;
  v_new := v.quote_version + 1;
  update public.orders set quote_price_egp=p_price, quote_version=v_new, status='quoted', updated_at=now() where id=p_order;
  insert into public.order_events(order_id,actor_id,from_status,to_status,note)
  values(p_order,(select auth.uid()),v.status,'quoted','عرض سعر رقم '||v_new||': '||p_price);
  return v_new;
end $$;

create or replace function public.accept_quote(p_order uuid, p_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.orders%rowtype;
begin
  select * into v from public.orders where id=p_order for update;
  if not found or v.customer_id is distinct from (select auth.uid()) then raise exception 'الطلب ده مش بتاعك' using errcode='42501'; end if;
  if v.status <> 'quoted' then raise exception 'لا يوجد عرض سعر بانتظار موافقتك' using errcode='22023'; end if;
  if v.quote_version <> p_version then raise exception 'تم تحديث عرض السعر، راجع السعر الجديد قبل الموافقة' using errcode='22023'; end if;
  update public.orders set price_egp=v.quote_price_egp,
    deposit_egp=case when v.quote_price_egp > 300 then floor(v.quote_price_egp*0.25+0.5)::int else 0 end,
    status='confirmed', updated_at=now() where id=p_order;
  insert into public.order_events(order_id,actor_id,from_status,to_status,note)
  values(p_order,(select auth.uid()),'quoted','confirmed','وافق العميل على عرض السعر رقم '||p_version||': '||v.quote_price_egp);
end $$;

create or replace function public.decline_quote(p_order uuid, p_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.orders%rowtype;
begin
  select * into v from public.orders where id=p_order for update;
  if not found or v.customer_id is distinct from (select auth.uid()) then raise exception 'الطلب ده مش بتاعك' using errcode='42501'; end if;
  if v.status <> 'quoted' or v.quote_version <> p_version then raise exception 'لا يوجد عرض سعر مطابق' using errcode='22023'; end if;
  update public.orders set status='cancelled', updated_at=now() where id=p_order;
  insert into public.order_events(order_id,actor_id,from_status,to_status,note)
  values(p_order,(select auth.uid()),'quoted','cancelled','رفض العميل عرض السعر رقم '||p_version);
end $$;
revoke all on function public.quote_order_v3(uuid,int), public.accept_quote(uuid,int), public.decline_quote(uuid,int) from public, anon;
grant execute on function public.quote_order_v3(uuid,int), public.accept_quote(uuid,int), public.decline_quote(uuid,int) to authenticated;
select 'ok' r, (select string_agg(conname,',') from pg_constraint where conrelid='public.orders'::regclass and contype='c') cons;
