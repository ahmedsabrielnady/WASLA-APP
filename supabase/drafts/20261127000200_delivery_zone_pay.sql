-- wasla-test ONLY. Draft, not a production migration. Zone-based courier pay (inside / outside Shibin), per-delivery snapshot, budget by actual pay.
-- Apply after the promo and dispatch drafts. Owner decision (27 Nov 16:06): courier pay 20 EGP inside Shibin, 35 EGP outside, one way. Caps stay unset until the owner approves.
-- How inside/outside is decided: every service area in delivery_areas carries a zone. The delivery's area (picked by the customer, or by staff for cart orders) is looked up; its zone picks the pay.
-- The pay is copied onto the delivery when it is created (snapshot), so later price changes never rewrite old rows.

-- 1. schema
alter table public.delivery_areas add column if not exists zone text not null default 'inside' check (zone in ('inside','outside'));
do $m$ begin
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='delivery_promo' and column_name='courier_pay_egp') then
  alter table public.delivery_promo rename column courier_pay_egp to courier_pay_inside_egp;
 end if;
end $m$;
alter table public.delivery_promo add column if not exists courier_pay_outside_egp int check (courier_pay_outside_egp is null or courier_pay_outside_egp between 0 and 500);
alter table public.delivery_requests add column if not exists zone text check (zone in ('inside','outside'));

-- 2. areas: two lists, public read returns the zone too
drop function if exists public.delivery_areas_public();
create or replace function public.delivery_areas_public() returns table(out_name text, out_zone text)
language sql stable security definer set search_path = '' as $$ select name, zone from public.delivery_areas where active order by zone, name; $$;
revoke all on function public.delivery_areas_public() from public;
grant execute on function public.delivery_areas_public() to anon, authenticated;

drop function if exists public.admin_set_delivery_areas(text[]);
create or replace function public.admin_set_delivery_areas(p_inside text[], p_outside text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n text;
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode='42501'; end if;
 if coalesce(array_length(p_inside,1),0) + coalesce(array_length(p_outside,1),0) > 40 then raise exception 'عدد المناطق كبير' using errcode='22023'; end if;
 if exists (select 1 from unnest(coalesce(p_inside,'{}')) a(x) join unnest(coalesce(p_outside,'{}')) b(y) on trim(a.x) = trim(b.y)) then
  raise exception 'المنطقة لا يمكن أن تكون داخل شبين وخارجها معًا' using errcode='22023'; end if;
 delete from public.delivery_areas;
 foreach n in array coalesce(p_inside,'{}') loop n := trim(n); if char_length(n) between 2 and 60 then insert into public.delivery_areas(name, zone) values (n, 'inside') on conflict do nothing; end if; end loop;
 foreach n in array coalesce(p_outside,'{}') loop n := trim(n); if char_length(n) between 2 and 60 then insert into public.delivery_areas(name, zone) values (n, 'outside') on conflict do nothing; end if; end loop;
end $$;
revoke all on function public.admin_set_delivery_areas(text[], text[]) from public, anon;
grant execute on function public.admin_set_delivery_areas(text[], text[]) to authenticated;

-- 3. one decision: zone from the area, pay from the zone, budget check with the actual pay
create or replace function public._delivery_decision(p_customer uuid, p_dropoff text, p_area text)
returns table(out_free boolean, out_list_fee int, out_pay int, out_zone text)
language plpgsql security definer set search_path = '' as $$
declare v_cfg public.delivery_promo%rowtype; v_n int; v_spent int; v_cust int; v_addr int; v_free boolean := false; v_zone text; v_pay int;
begin
 select * into v_cfg from public.delivery_promo where id = 1 for update;
 select zone into v_zone from public.delivery_areas where active and name = trim(coalesce(p_area,''));
 -- no area found (empty list = unrestricted): count it as outside, the higher pay, so the budget is never understated
 v_pay := case when coalesce(v_zone,'outside') = 'inside' then v_cfg.courier_pay_inside_egp else v_cfg.courier_pay_outside_egp end;
 if v_cfg.enabled and v_pay is not null and v_cfg.max_free_deliveries > 0 and v_cfg.budget_cap_egp > 0
 and (v_cfg.starts_at is null or now() >= v_cfg.starts_at) and (v_cfg.ends_at is null or now() < v_cfg.ends_at) then
  select count(*), coalesce(sum(courier_pay_egp),0) into v_n, v_spent from public.delivery_requests where promo_applied and status <> 'cancelled';
  select count(*) into v_cust from public.delivery_requests where promo_applied and status <> 'cancelled' and customer_id = p_customer;
  select count(*) into v_addr from public.delivery_requests where promo_applied and status <> 'cancelled' and lower(regexp_replace(dropoff_address,'\s+',' ','g')) = lower(regexp_replace(trim(p_dropoff),'\s+',' ','g'));
  if v_n < v_cfg.max_free_deliveries and v_spent + v_pay <= v_cfg.budget_cap_egp and v_cust < v_cfg.per_customer_limit and v_addr < v_cfg.per_customer_limit then v_free := true; end if;
 end if;
 -- the pay is snapshotted on every delivery (free or not), the budget only counts promo deliveries
 return query select v_free, v_cfg.list_fee_egp, v_pay, coalesce(v_zone, case when v_pay is null then null else 'outside' end);
end $$;
revoke all on function public._delivery_decision(uuid,text,text) from public, anon, authenticated;

create or replace function public.place_delivery_request(p_pickup text, p_dropoff text, p_what text, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int; d record;
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if (select role from public.profiles where id = v_uid) is distinct from 'customer' then raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if;
 if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
  raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
 if not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if;
 select count(*) into v_open from public.delivery_requests where customer_id = v_uid and status in ('new','assigned','picked_up');
 if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if;
 select count(*) into v_recent from public.delivery_requests where customer_id = v_uid and created_at > now() - interval '1 hour';
 if v_recent >= 6 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400'; end if;
 select * into d from public._delivery_decision(v_uid, p_dropoff, p_area);
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,area,zone,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what), nullif(trim(coalesce(p_area,'')),''), d.out_zone, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.place_delivery_request(text,text,text,text) from public, anon;
grant execute on function public.place_delivery_request(text,text,text,text) to authenticated;

create or replace function public.staff_dispatch_order(p_order uuid, p_area text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; v_name text; v_id uuid; d record;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select * into o from public.orders where id = p_order for update;
 if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;
 if o.product_id is null or o.sector <> 'store' then raise exception 'التوصيل متاح لطلبات المتجر فقط' using errcode='22023'; end if;
 if o.status not in ('confirmed','in_progress') then raise exception 'الطلب لازم يكون مؤكد من التاجر أولًا' using errcode='22023'; end if;
 if not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if;
 if exists (select 1 from public.delivery_requests where order_id = p_order and status <> 'cancelled') then raise exception 'تم تحويل الطلب لمندوب بالفعل' using errcode='22023'; end if;
 select coalesce(display_name,'التاجر') into v_name from public.providers where id = o.provider_id;
 select * into d from public._delivery_decision(o.customer_id, o.address, p_area);
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,order_id,area,zone,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (o.customer_id, 'من '||coalesce(v_name,'التاجر'), o.address, 'طلب '||o.ref, o.id, nullif(trim(coalesce(p_area,'')),''), d.out_zone, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.staff_dispatch_order(uuid,text) from public, anon;
grant execute on function public.staff_dispatch_order(uuid,text) to authenticated;
drop function if exists public._delivery_decision(uuid,text);

-- 4. promo config (two pays) and status
drop function if exists public.admin_set_delivery_promo(boolean,int,timestamptz,timestamptz,int,int,int,int);
create or replace function public.admin_set_delivery_promo(p_enabled boolean, p_list_fee int, p_starts timestamptz, p_ends timestamptz, p_max_free int, p_per_customer int, p_pay_inside int, p_pay_outside int, p_budget int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
  raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501'; end if;
 if p_enabled then
  if p_pay_inside is null or p_pay_outside is null or p_max_free is null or p_max_free < 1 or p_budget is null or p_budget < greatest(p_pay_inside, p_pay_outside) or p_per_customer is null or p_per_customer < 1 then
   raise exception 'لتفعيل العرض لازم تحدد أجر المندوب داخل وخارج شبين وعدد التوصيلات المجانية والميزانية والحد لكل عميل' using errcode = '22023'; end if;
  if not exists (select 1 from public.delivery_areas where active) then
   raise exception 'حدد مناطق التوصيل أولًا، علشان نعرف الأجر داخل أو خارج شبين' using errcode = '22023'; end if;
 end if;
 if coalesce(p_budget,0) > 5000 then raise exception 'الحد الأقصى للميزانية 5000 جنيه' using errcode = '22023'; end if; -- owner ceiling 27 Nov 16:08, not an approved cap
 if p_ends is not null and p_starts is not null and p_ends <= p_starts then raise exception 'تاريخ النهاية قبل البداية' using errcode = '22023'; end if;
 update public.delivery_promo set enabled = coalesce(p_enabled,false), list_fee_egp = coalesce(p_list_fee, list_fee_egp), starts_at = p_starts, ends_at = p_ends,
  max_free_deliveries = coalesce(p_max_free,0), per_customer_limit = coalesce(p_per_customer,1), courier_pay_inside_egp = p_pay_inside, courier_pay_outside_egp = p_pay_outside,
  budget_cap_egp = coalesce(p_budget,0), updated_by = v_uid, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_set_delivery_promo(boolean,int,timestamptz,timestamptz,int,int,int,int,int) from public, anon;
grant execute on function public.admin_set_delivery_promo(boolean,int,timestamptz,timestamptz,int,int,int,int,int) to authenticated;

drop function if exists public.admin_delivery_promo_status();
create or replace function public.admin_delivery_promo_status()
returns table(out_enabled boolean, out_open boolean, out_list_fee int, out_ends_at timestamptz, out_free_used int, out_free_max int, out_delivered_free int, out_committed_egp int, out_budget_egp int, out_remaining_egp int, out_per_customer int, out_pay_inside int, out_pay_outside int, out_free_inside int, out_free_outside int, out_worst_case_egp int)
language plpgsql security definer set search_path = '' as $$
declare c public.delivery_promo%rowtype; n int; d int; s int; fi int; fo int;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select * into c from public.delivery_promo where id = 1;
 select count(*), count(*) filter (where status='delivered'), coalesce(sum(courier_pay_egp),0), count(*) filter (where zone='inside'), count(*) filter (where zone is distinct from 'inside') into n, d, s, fi, fo
  from public.delivery_requests where promo_applied and status <> 'cancelled';
 return query select c.enabled,
  (c.enabled and c.courier_pay_inside_egp is not null and c.courier_pay_outside_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at) and n < c.max_free_deliveries and s + greatest(c.courier_pay_inside_egp, c.courier_pay_outside_egp) <= c.budget_cap_egp),
  c.list_fee_egp, c.ends_at, n, c.max_free_deliveries, d, s, c.budget_cap_egp, greatest(c.budget_cap_egp - s, 0), c.per_customer_limit,
  c.courier_pay_inside_egp, c.courier_pay_outside_egp, fi, fo, c.max_free_deliveries * greatest(coalesce(c.courier_pay_inside_egp,0), coalesce(c.courier_pay_outside_egp,0));
end $$;
revoke all on function public.admin_delivery_promo_status() from public, anon;
grant execute on function public.admin_delivery_promo_status() to authenticated;

create or replace function public.delivery_promo_public()
returns table(out_open boolean, out_list_fee int, out_ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select (c.enabled and c.courier_pay_inside_egp is not null and c.courier_pay_outside_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at)
 and (select count(*) from public.delivery_requests where promo_applied and status <> 'cancelled') < c.max_free_deliveries
 and (select coalesce(sum(courier_pay_egp),0) from public.delivery_requests where promo_applied and status <> 'cancelled') + greatest(c.courier_pay_inside_egp, c.courier_pay_outside_egp) <= c.budget_cap_egp),
 c.list_fee_egp, c.ends_at from public.delivery_promo c where c.id = 1;
$$;
revoke all on function public.delivery_promo_public() from public;
grant execute on function public.delivery_promo_public() to anon, authenticated;
