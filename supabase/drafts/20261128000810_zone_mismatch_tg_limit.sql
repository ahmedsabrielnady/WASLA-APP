-- wasla-test ONLY. Draft. Security review fixes M3 (pin vs typed area flag) and L2 (telegram link-code attempts limit, longer code).
alter table public.delivery_requests add column if not exists zone_mismatch boolean not null default false;
CREATE OR REPLACE FUNCTION public.place_delivery_request(p_pickup text, p_dropoff text, p_what text, p_area text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$ declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int; d record; v_pin text; v_src text; v_mis boolean := false; begin if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if; if (select role from public.profiles where id = v_uid) is distinct from 'customer' then raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if; if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if; v_pin := public.delivery_zone_for_point(p_lat, p_lng); v_src := case when v_pin is null then 'area' else 'pin' end; if v_pin is not null and nullif(trim(coalesce(p_area,'')),'') is not null then v_mis := (select dd.out_zone from public._delivery_decision(v_uid, p_dropoff, p_area, null) dd) is distinct from v_pin; end if; if v_pin is null and not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if; select count(*) into v_open from public.delivery_requests where customer_id = v_uid and status in ('new','assigned','picked_up'); if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if; select count(*) into v_recent from public.delivery_requests where customer_id = v_uid and created_at > now() - interval '1 hour'; if v_recent >= 6 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400'; end if; select * into d from public._delivery_decision(v_uid, p_dropoff, p_area, v_pin); insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,area,zone,zone_source,zone_mismatch,promo_area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp) values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what), nullif(trim(coalesce(p_area,'')),''), d.out_zone, v_src, v_mis, d.out_promo_area, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id; return v_id; end $f$;
create table if not exists public.telegram_link_failures (id bigserial primary key, chat_id bigint not null, at timestamptz not null default now());
create index if not exists telegram_link_failures_idx on public.telegram_link_failures(chat_id, at);
alter table public.telegram_link_failures enable row level security;
revoke all on public.telegram_link_failures from anon, authenticated;
create or replace function public.provider_telegram_link_code() returns text language plpgsql security definer set search_path = '' as $f$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not exists (select 1 from public.providers p where p.user_id = auth.uid() and p.approved and p.active) then raise exception 'الحساب غير معتمد كمقدم خدمة' using errcode = '42501'; end if;
  v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 14));
  insert into public.provider_telegram(user_id, link_code, link_expires_at) values (auth.uid(), v_code, now() + interval '15 minutes')
  on conflict (user_id) do update set link_code = excluded.link_code, link_expires_at = excluded.link_expires_at;
  return v_code;
end $f$;
-- guesses limited: 5 failed codes per chat per 15 minutes, 60 failures overall per hour. Over the limit the check is skipped and returns false.
create or replace function public.telegram_link_chat(p_code text, p_chat bigint) returns boolean language plpgsql security definer set search_path = '' as $f$
declare n int;
begin
  if (select count(*) from public.telegram_link_failures where chat_id = p_chat and at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.telegram_link_failures where at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  update public.provider_telegram set chat_id = p_chat, linked_at = now(), link_code = null, link_expires_at = null
   where link_code = pg_catalog.upper(pg_catalog.btrim(coalesce(p_code,''))) and link_expires_at > now();
  get diagnostics n = row_count;
  if n <> 1 then insert into public.telegram_link_failures(chat_id) values (p_chat); delete from public.telegram_link_failures where at < now() - interval '1 day'; end if;
  return n = 1;
end $f$;
revoke all on function public.telegram_link_chat(text,bigint) from public, anon, authenticated;
