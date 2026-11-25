-- Archive of the live production patch applied on 2026-11-25.
-- Adds strict optional coordinate-pair validation to the public order RPC.
-- Existing behavior is preserved: both coordinates may be NULL.
-- No grants, order rows, or provider data are changed by this function replacement.

create or replace function public.place_order_v2(
  p_sector text,
  p_item_id integer,
  p_address text,
  p_notes text default null,
  p_source text default 'web',
  p_idempotency_key text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(
  out_order_id uuid,
  out_ref text,
  out_deposit_egp integer,
  out_price_egp integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_uid uuid := (select auth.uid());
 v_item public.service_items%rowtype;
 v_order public.orders%rowtype;
 v_source text;
 v_price integer;
 v_deposit integer;
 v_recent integer;
begin
 if v_uid is null then
   raise exception 'سجل الدخول أولًا' using errcode='28000';
 end if;

 if p_sector is null or p_sector not in ('maintenance','car') then
   raise exception 'هذا القطاع غير متاح للطلب العام حاليًا' using errcode='22023';
 end if;

 if p_address is null or char_length(trim(p_address)) < 4 or char_length(trim(p_address)) > 255 then
   raise exception 'العنوان غير صالح' using errcode='22023';
 end if;
 if p_notes is not null and char_length(p_notes) > 500 then
   raise exception 'الملاحظات أطول من المسموح' using errcode='22023';
 end if;
 if p_idempotency_key is not null and
    (char_length(trim(p_idempotency_key)) < 8 or char_length(trim(p_idempotency_key)) > 128) then
   raise exception 'مفتاح منع التكرار غير صالح' using errcode='22023';
 end if;

 -- Coordinates are optional, but must be supplied as a valid pair.
 if (p_lat is null) <> (p_lng is null) then
   raise exception 'لازم تبعت خط العرض والطول مع بعض' using errcode='22023';
 end if;
 if p_lat is not null and
    (p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180) then
   raise exception 'إحداثيات الموقع خارج النطاق الصحيح' using errcode='22023';
 end if;

 v_source := case when p_source in ('web','app','whatsapp','walkin') then p_source else 'web' end;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));

 if p_idempotency_key is not null then
   select * into v_order from public.orders
   where customer_id=v_uid and idempotency_key=trim(p_idempotency_key);
   if found then
     return query select v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;
     return;
   end if;
 end if;

 if not (
   exists(select 1 from public.consents where user_id=v_uid and kind='terms')
   and exists(select 1 from public.consents where user_id=v_uid and kind='privacy')
 ) then
   raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501';
 end if;

 select count(*) into v_recent
 from public.orders
 where customer_id=v_uid and created_at > pg_catalog.now()-interval '10 minutes';
 if v_recent >= 5 then
   raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400';
 end if;

 select * into v_item
 from public.service_items
 where id=p_item_id and sector=p_sector and active=true and public_orderable=true
 for share;
 if not found then
   raise exception 'الخدمة دي مش متاحة للطلب حاليًا' using errcode='22023';
 end if;

 v_price := v_item.price_egp;
 v_deposit := case when coalesce(v_price,0)>300
                   then floor(v_price*0.25+0.5)::integer else 0 end;

 insert into public.orders(
   customer_id,sector,item_id,address,notes,price_egp,deposit_egp,source,
   lat,lng,idempotency_key
 ) values (
   v_uid,p_sector,p_item_id,trim(p_address),nullif(trim(coalesce(p_notes,'')),''),
   v_price,v_deposit,v_source,p_lat,p_lng,nullif(trim(coalesce(p_idempotency_key,'')),'')
 )
 returning * into v_order;

 insert into public.order_events(order_id,actor_id,from_status,to_status,note)
 values(v_order.id,v_uid,null,'new','تم استلام الطلب');

 return query select v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;

exception when unique_violation then
 if p_idempotency_key is not null then
   select * into v_order from public.orders
   where customer_id=v_uid and idempotency_key=trim(p_idempotency_key);
   if found then
     return query select v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;
     return;
   end if;
 end if;
 raise;
end;
$function$;
