-- wasla-test ONLY. Draft. Applies after wasla-draft-delivery-area-promos.sql and wasla-draft-zone-by-pin.sql.
-- Zone from the customer's pinned delivery point. Owner-drawn polygon (Telegram 26065169) is loaded below.
-- Rules: pin given and a polygon configured => inside/outside from the point (area name no longer needs to be in the list); no pin => typed area list; unmatched => outside.
alter table public.delivery_requests add column if not exists zone_source text check (zone_source in ('pin','area'));
delete from public.delivery_zone_polygons where true;
insert into public.delivery_zone_polygons(label, ring) values ('Shibin inside zone (drawn by owner)', '[[30.321757,31.312192],[30.316277,31.332664],[30.304405,31.324397],[30.309715,31.306771]]'::jsonb);

drop function if exists public._delivery_decision(uuid,text,text);
drop function if exists public._delivery_decision(uuid,text,text,text);
create or replace function public._delivery_decision(p_customer uuid, p_dropoff text, p_area text, p_zone_hint text default null)
returns table(out_free boolean, out_list_fee int, out_pay int, out_zone text, out_promo_area text)
language plpgsql security definer set search_path = '' as $$
declare v_cfg public.delivery_promo%rowtype; a public.delivery_area_promos%rowtype; v_n int; v_spent int; v_cust int; v_addr int; v_free boolean := false; v_zone text; v_pay int; v_area text := trim(coalesce(p_area,'')); v_pa text := null; v_addr_n text := lower(regexp_replace(trim(p_dropoff),'\s+',' ','g'));
begin
 select * into v_cfg from public.delivery_promo where id = 1 for update;
 -- zone: the pinned point when given (p_zone_hint), else the typed area, else outside (unmatched is outside)
 select zone into v_zone from public.delivery_areas where active and name = v_area;
 v_zone := coalesce(p_zone_hint, v_zone, 'outside'); -- unmatched counts as outside: never free by the main promo, higher pay snapshot
 v_pay := case when v_zone = 'inside' then v_cfg.courier_pay_inside_egp else v_cfg.courier_pay_outside_egp end;
 if v_pay is not null then
  if v_zone = 'inside' then
   if v_cfg.enabled and v_cfg.max_free_deliveries > 0 and v_cfg.budget_cap_egp > 0 and (v_cfg.starts_at is null or now() >= v_cfg.starts_at) and (v_cfg.ends_at is null or now() < v_cfg.ends_at) then
    select count(*), coalesce(sum(courier_pay_egp),0) into v_n, v_spent from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled';
    select count(*) into v_cust from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled' and customer_id = p_customer;
    select count(*) into v_addr from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled' and lower(regexp_replace(dropoff_address,'\s+',' ','g')) = v_addr_n;
    if v_n < v_cfg.max_free_deliveries and v_spent + v_pay <= v_cfg.budget_cap_egp and v_cust < v_cfg.per_customer_limit and v_addr < v_cfg.per_customer_limit then v_free := true; end if;
   end if;
  else
   select * into a from public.delivery_area_promos where area = v_area for update;
   if found and a.enabled and a.max_free_deliveries > 0 and a.budget_cap_egp > 0 and (a.starts_at is null or now() >= a.starts_at) and (a.ends_at is null or now() < a.ends_at) then
    select count(*), coalesce(sum(courier_pay_egp),0) into v_n, v_spent from public.delivery_requests where promo_applied and promo_area = v_area and status <> 'cancelled';
    select count(*) into v_cust from public.delivery_requests where promo_applied and promo_area = v_area and status <> 'cancelled' and customer_id = p_customer;
    select count(*) into v_addr from public.delivery_requests where promo_applied and promo_area = v_area and status <> 'cancelled' and lower(regexp_replace(dropoff_address,'\s+',' ','g')) = v_addr_n;
    if v_n < a.max_free_deliveries and v_spent + v_pay <= a.budget_cap_egp and v_cust < a.per_customer_limit and v_addr < a.per_customer_limit then v_free := true; v_pa := v_area; end if;
   end if;
  end if;
 end if;
 return query select v_free, v_cfg.list_fee_egp, v_pay, case when v_pay is null then null else v_zone end, v_pa;
end $$;
revoke all on function public._delivery_decision(uuid,text,text,text) from public, anon, authenticated;

drop function if exists public.place_delivery_request(text,text,text,text);
create or replace function public.place_delivery_request(p_pickup text, p_dropoff text, p_what text, p_area text default null, p_lat double precision default null, p_lng double precision default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int; d record; v_pin text; v_src text;
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if (select role from public.profiles where id = v_uid) is distinct from 'customer' then raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if;
 if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
  raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
 v_pin := public.delivery_zone_for_point(p_lat, p_lng); v_src := case when v_pin is null then 'area' else 'pin' end;
 if v_pin is null and not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if;
 select count(*) into v_open from public.delivery_requests where customer_id = v_uid and status in ('new','assigned','picked_up');
 if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if;
 select count(*) into v_recent from public.delivery_requests where customer_id = v_uid and created_at > now() - interval '1 hour';
 if v_recent >= 6 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400'; end if;
 select * into d from public._delivery_decision(v_uid, p_dropoff, p_area, v_pin);
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,area,zone,zone_source,promo_area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what), nullif(trim(coalesce(p_area,'')),''), d.out_zone, v_src, d.out_promo_area, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.place_delivery_request(text,text,text,text,double precision,double precision) from public, anon;
grant execute on function public.place_delivery_request(text,text,text,text,double precision,double precision) to authenticated;

