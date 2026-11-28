-- wasla-test ONLY. Draft, not a production migration. Applies after wasla-draft-delivery-zone-pay.sql.
-- Owner decision (27 Nov 16:21): the main free-delivery promo applies INSIDE Shibin only (cap 3500 EGP approved as a number, not applied to production).
-- Outside Shibin is paid by the customer by default. Each new outside area can get its own free offer (own count, dates, budget, per-customer limit).
-- Staff prepare an area offer (always saved disabled). Only the founder (admin) can enable it, which is the owner approval step. Nothing here is applied to production.
-- Open: what the customer pays outside Shibin and how it is collected (the list fee is used as a placeholder).

alter table public.delivery_requests add column if not exists promo_area text; -- null = main inside promo, else the outside area whose own offer paid for it

create table if not exists public.delivery_area_promos (
 area text primary key check (char_length(area) between 2 and 60),
 enabled boolean not null default false,
 starts_at timestamptz, ends_at timestamptz,
 max_free_deliveries int not null default 0 check (max_free_deliveries between 0 and 100000),
 per_customer_limit int not null default 1 check (per_customer_limit between 1 and 20),
 budget_cap_egp int not null default 0 check (budget_cap_egp between 0 and 5000),
 updated_by uuid, updated_at timestamptz not null default now(), approved_by uuid, approved_at timestamptz
);
alter table public.delivery_area_promos enable row level security;
revoke all on public.delivery_area_promos from public, anon, authenticated;

drop function if exists public._delivery_decision(uuid,text,text);
create or replace function public._delivery_decision(p_customer uuid, p_dropoff text, p_area text)
returns table(out_free boolean, out_list_fee int, out_pay int, out_zone text, out_promo_area text)
language plpgsql security definer set search_path = '' as $$
declare v_cfg public.delivery_promo%rowtype; a public.delivery_area_promos%rowtype; v_n int; v_spent int; v_cust int; v_addr int; v_free boolean := false; v_zone text; v_pay int; v_area text := trim(coalesce(p_area,'')); v_pa text := null; v_addr_n text := lower(regexp_replace(trim(p_dropoff),'\s+',' ','g'));
begin
 select * into v_cfg from public.delivery_promo where id = 1 for update;
 select zone into v_zone from public.delivery_areas where active and name = v_area;
 v_zone := coalesce(v_zone, 'outside'); -- unmatched counts as outside: never free by the main promo, higher pay snapshot
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
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,area,zone,promo_area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what), nullif(trim(coalesce(p_area,'')),''), d.out_zone, d.out_promo_area, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
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
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,order_id,area,zone,promo_area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (o.customer_id, 'من '||coalesce(v_name,'التاجر'), o.address, 'طلب '||o.ref, o.id, nullif(trim(coalesce(p_area,'')),''), d.out_zone, d.out_promo_area, d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.staff_dispatch_order(uuid,text) from public, anon;
grant execute on function public.staff_dispatch_order(uuid,text) to authenticated;

-- per-area offers: staff prepare (saved disabled), only the founder enables
create or replace function public.staff_set_area_promo(p_area text, p_enabled boolean, p_starts timestamptz, p_ends timestamptz, p_max_free int, p_per_customer int, p_budget int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_admin boolean; v_pay int; v_area text := trim(coalesce(p_area,''));
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 v_admin := exists (select 1 from public.profiles where id = v_uid and role = 'admin');
 if not exists (select 1 from public.delivery_areas where active and zone = 'outside' and name = v_area) then raise exception 'العرض الخاص بالمناطق خارج شبين فقط، أضف المنطقة في قائمة خارج شبين أولًا' using errcode='22023'; end if;
 if coalesce(p_budget,0) > 5000 then raise exception 'الحد الأقصى للميزانية 5000 جنيه' using errcode='22023'; end if;
 if p_ends is not null and p_starts is not null and p_ends <= p_starts then raise exception 'تاريخ النهاية قبل البداية' using errcode='22023'; end if;
 if coalesce(p_enabled,false) then
  if not v_admin then raise exception 'تفعيل العرض يحتاج موافقة المؤسس' using errcode='42501'; end if;
  select courier_pay_outside_egp into v_pay from public.delivery_promo where id = 1;
  if v_pay is null or p_max_free is null or p_max_free < 1 or p_per_customer is null or p_per_customer < 1 or p_budget is null or p_budget < v_pay then
   raise exception 'لتفعيل العرض لازم تحدد العدد والحد لكل عميل والميزانية، وأجر المندوب خارج شبين' using errcode='22023'; end if;
 end if;
 insert into public.delivery_area_promos(area, enabled, starts_at, ends_at, max_free_deliveries, per_customer_limit, budget_cap_egp, updated_by, updated_at, approved_by, approved_at)
 values (v_area, coalesce(p_enabled,false), p_starts, p_ends, coalesce(p_max_free,0), coalesce(p_per_customer,1), coalesce(p_budget,0), v_uid, now(), case when coalesce(p_enabled,false) then v_uid end, case when coalesce(p_enabled,false) then now() end)
 on conflict (area) do update set enabled = excluded.enabled, starts_at = excluded.starts_at, ends_at = excluded.ends_at, max_free_deliveries = excluded.max_free_deliveries, per_customer_limit = excluded.per_customer_limit,
  budget_cap_egp = excluded.budget_cap_egp, updated_by = v_uid, updated_at = now(), approved_by = excluded.approved_by, approved_at = excluded.approved_at;
end $$;
revoke all on function public.staff_set_area_promo(text,boolean,timestamptz,timestamptz,int,int,int) from public, anon;
grant execute on function public.staff_set_area_promo(text,boolean,timestamptz,timestamptz,int,int,int) to authenticated;

create or replace function public.staff_area_promos_status()
returns table(out_area text, out_enabled boolean, out_open boolean, out_starts timestamptz, out_ends timestamptz, out_free_used int, out_free_max int, out_committed_egp int, out_budget_egp int, out_remaining_egp int, out_per_customer int, out_approved boolean)
language plpgsql security definer set search_path = '' as $$
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 return query select p.area, p.enabled,
  (p.enabled and (p.starts_at is null or now() >= p.starts_at) and (p.ends_at is null or now() < p.ends_at) and u.n < p.max_free_deliveries and u.s + coalesce(c.courier_pay_outside_egp,0) <= p.budget_cap_egp),
  p.starts_at, p.ends_at, u.n, p.max_free_deliveries, u.s, p.budget_cap_egp, greatest(p.budget_cap_egp - u.s, 0), p.per_customer_limit, p.approved_at is not null
 from public.delivery_area_promos p cross join (select * from public.delivery_promo where id = 1) c
 cross join lateral (select count(*)::int n, coalesce(sum(r.courier_pay_egp),0)::int s from public.delivery_requests r where r.promo_applied and r.promo_area = p.area and r.status <> 'cancelled') u
 order by p.area;
end $$;
revoke all on function public.staff_area_promos_status() from public, anon;
grant execute on function public.staff_area_promos_status() to authenticated;

-- customer-facing: does this area have a free offer right now
create or replace function public.delivery_promo_for_area(p_area text)
returns table(out_open boolean, out_list_fee int, out_ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select coalesce(case when z.zone = 'inside' then (select out_open from public.delivery_promo_public())
  else (p.enabled and (p.starts_at is null or now() >= p.starts_at) and (p.ends_at is null or now() < p.ends_at)
   and (select count(*) from public.delivery_requests where promo_applied and promo_area = p.area and status <> 'cancelled') < p.max_free_deliveries
   and (select coalesce(sum(courier_pay_egp),0) from public.delivery_requests where promo_applied and promo_area = p.area and status <> 'cancelled') + coalesce(c.courier_pay_outside_egp,0) <= p.budget_cap_egp) end, false),
 c.list_fee_egp, case when z.zone = 'inside' then c.ends_at else p.ends_at end
 from public.delivery_promo c left join public.delivery_areas z on z.active and z.name = trim(coalesce(p_area,'')) left join public.delivery_area_promos p on p.area = z.name and z.zone = 'outside' where c.id = 1;
$$;
revoke all on function public.delivery_promo_for_area(text) from public;
grant execute on function public.delivery_promo_for_area(text) to anon, authenticated;

-- main promo is inside-only now: its status/banner count inside promo deliveries and use the inside pay
create or replace function public.admin_set_delivery_promo(p_enabled boolean, p_list_fee int, p_starts timestamptz, p_ends timestamptz, p_max_free int, p_per_customer int, p_pay_inside int, p_pay_outside int, p_budget int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501'; end if;
 if p_enabled then
  if p_pay_inside is null or p_max_free is null or p_max_free < 1 or p_budget is null or p_budget < p_pay_inside or p_per_customer is null or p_per_customer < 1 then
   raise exception 'لتفعيل العرض لازم تحدد أجر المندوب داخل شبين وعدد التوصيلات المجانية والميزانية والحد لكل عميل' using errcode = '22023'; end if;
  if not exists (select 1 from public.delivery_areas where active and zone = 'inside') then raise exception 'حدد مناطق داخل شبين أولًا' using errcode = '22023'; end if;
 end if;
 if coalesce(p_budget,0) > 5000 then raise exception 'الحد الأقصى للميزانية 5000 جنيه' using errcode = '22023'; end if;
 if p_ends is not null and p_starts is not null and p_ends <= p_starts then raise exception 'تاريخ النهاية قبل البداية' using errcode = '22023'; end if;
 update public.delivery_promo set enabled = coalesce(p_enabled,false), list_fee_egp = coalesce(p_list_fee, list_fee_egp), starts_at = p_starts, ends_at = p_ends,
  max_free_deliveries = coalesce(p_max_free,0), per_customer_limit = coalesce(p_per_customer,1), courier_pay_inside_egp = p_pay_inside, courier_pay_outside_egp = p_pay_outside,
  budget_cap_egp = coalesce(p_budget,0), updated_by = v_uid, updated_at = now() where id = 1;
end $$;

create or replace function public.admin_delivery_promo_status()
returns table(out_enabled boolean, out_open boolean, out_list_fee int, out_ends_at timestamptz, out_free_used int, out_free_max int, out_delivered_free int, out_committed_egp int, out_budget_egp int, out_remaining_egp int, out_per_customer int, out_pay_inside int, out_pay_outside int, out_free_inside int, out_free_outside int, out_worst_case_egp int)
language plpgsql security definer set search_path = '' as $$
declare c public.delivery_promo%rowtype; n int; d int; s int;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select * into c from public.delivery_promo where id = 1;
 select count(*), count(*) filter (where status='delivered'), coalesce(sum(courier_pay_egp),0) into n, d, s from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled';
 return query select c.enabled,
  (c.enabled and c.courier_pay_inside_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at) and n < c.max_free_deliveries and s + c.courier_pay_inside_egp <= c.budget_cap_egp),
  c.list_fee_egp, c.ends_at, n, c.max_free_deliveries, d, s, c.budget_cap_egp, greatest(c.budget_cap_egp - s, 0), c.per_customer_limit,
  c.courier_pay_inside_egp, c.courier_pay_outside_egp, n, 0, c.max_free_deliveries * coalesce(c.courier_pay_inside_egp,0);
end $$;

create or replace function public.delivery_promo_public()
returns table(out_open boolean, out_list_fee int, out_ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select (c.enabled and c.courier_pay_inside_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at)
 and (select count(*) from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled') < c.max_free_deliveries
 and (select coalesce(sum(courier_pay_egp),0) from public.delivery_requests where promo_applied and promo_area is null and status <> 'cancelled') + c.courier_pay_inside_egp <= c.budget_cap_egp),
 c.list_fee_egp, c.ends_at from public.delivery_promo c where c.id = 1;
$$;
