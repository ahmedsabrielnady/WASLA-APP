-- wasla-test ONLY. Draft: home nursing request RPC, NOT a production migration and NOT a public activation.
-- Nursing stays closed to the public. service_items.public_orderable cannot open it: the coverage trigger
-- (sync_service_item_orderability_from_coverage) forces it false for any sector except maintenance and car.
-- So this draft adds a separate switch, service_items.nursing_intake_open, default false. The owner flips it per item.
-- The RPC refuses unless the item is nursing, active, intake is open, at least one approved active non-test
-- provider covers the item, and the caller has accepted terms, privacy AND health_data consents (the consents table already
-- allows kind 'health_data'). Staff then assign an approved doctor or technician with assign_order_v2, and the provider
-- moves the order through the existing provider status RPC. No clinical records are created here.
-- Owner and legal gates (not decided here): health-data wording and retention, who may be assigned, prices, cancellation,
-- emergency disclaimer, minimum verified provider credentials.
alter table public.service_items add column if not exists nursing_intake_open boolean not null default false;

create or replace function public.request_nursing_visit(p_item integer, p_address text, p_notes text default null, p_idempotency_key text default null)
returns table(out_order_id uuid, out_ref text, out_price integer)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_item public.service_items%rowtype; v_order public.orders%rowtype; v_recent int;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if p_address is null or char_length(trim(p_address)) < 4 or char_length(trim(p_address)) > 255 then raise exception 'العنوان غير صالح' using errcode = '22023'; end if;
  if p_notes is not null and char_length(p_notes) > 500 then raise exception 'الملاحظات أطول من المسموح' using errcode = '22023'; end if;
  if p_idempotency_key is not null and (char_length(trim(p_idempotency_key)) < 8 or char_length(trim(p_idempotency_key)) > 128) then raise exception 'مفتاح منع التكرار غير صالح' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  if p_idempotency_key is not null then
    select * into v_order from public.orders where customer_id = v_uid and idempotency_key = trim(p_idempotency_key);
    if found then return query select v_order.id, v_order.ref, v_order.price_egp; return; end if;
  end if;
  if not (exists (select 1 from public.consents where user_id = v_uid and kind = 'terms')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'privacy')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'health_data')) then
    raise exception 'لازم توافق على الشروط والخصوصية والبيانات الصحية الأول' using errcode = '42501'; end if;
  select count(*) into v_recent from public.orders where customer_id = v_uid and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode = '53400'; end if;
  select * into v_item from public.service_items where id = p_item and sector = 'nursing' and active = true and nursing_intake_open = true for share;
  if not found or not exists (select 1 from public.provider_service_coverage c join public.providers pr on pr.id = c.provider_id where c.service_item_id = p_item and c.active and pr.approved and pr.active and not pr.is_test) then raise exception 'الخدمة دي مش متاحة للطلب حاليًا' using errcode = '22023'; end if;
  insert into public.orders (customer_id, sector, item_id, address, notes, price_egp, deposit_egp, source, idempotency_key)
  values (v_uid, 'nursing', p_item, trim(p_address), nullif(trim(coalesce(p_notes, '')), ''), v_item.price_egp, 0, 'web', nullif(trim(coalesce(p_idempotency_key, '')), ''))
  returning * into v_order;
  insert into public.order_events (order_id, actor_id, from_status, to_status, note) values (v_order.id, v_uid, null, 'new', 'تم استلام طلب التمريض');
  return query select v_order.id, v_order.ref, v_order.price_egp;
end $function$;
revoke all on function public.request_nursing_visit(integer,text,text,text) from public, anon;
grant execute on function public.request_nursing_visit(integer,text,text,text) to authenticated;
