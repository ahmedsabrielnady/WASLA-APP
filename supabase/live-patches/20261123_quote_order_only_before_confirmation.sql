-- Applied to Supabase project wasla as migration:
-- quote_order_only_before_confirmation
-- A quote can only be issued while an order is still new.

create or replace function public.quote_order(p_order uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
begin
  if not coalesce(public.is_staff(),false) then
    raise exception 'غير مصرح بإرسال عرض السعر' using errcode='42501';
  end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then
    raise exception 'السعر غير صالح' using errcode='22023';
  end if;
  select * into v_order from public.orders where id=p_order for update;
  if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;
  if v_order.status <> 'new' then
    raise exception 'لا يمكن تعديل السعر بعد تأكيد الطلب' using errcode='42501';
  end if;
  update public.orders
  set price_egp=p_price,
      deposit_egp=case when p_price > 300 then floor(p_price*0.25+0.5)::integer else 0 end,
      status='confirmed',
      updated_at=pg_catalog.now()
  where id=p_order;
  insert into public.order_events(order_id,actor_id,from_status,to_status,note)
  values(p_order,(select auth.uid()),'new','confirmed','تم إرسال عرض السعر: '||p_price);
end;
$function$;
revoke all on function public.quote_order(uuid,integer) from public, anon;
grant execute on function public.quote_order(uuid,integer) to authenticated;
