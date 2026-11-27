-- wasla-test ONLY. Draft, not a production migration. Delivery fee with a capped free-delivery promo.
-- Requires 20261125000100 (delivery_requests) and 20261125002000. Nothing here moves money: it records the fee the customer owes, the promo discount and the courier pay owed by the platform.
-- Open owner decisions: courier pay per delivery, how the paid fee is collected (cash to the courier is assumed nowhere), minimum order, service area.
create table if not exists public.delivery_promo (
 id int primary key default 1 check (id = 1),
 enabled boolean not null default false,
 list_fee_egp int not null default 20 check (list_fee_egp between 0 and 500),
 starts_at timestamptz,
 ends_at timestamptz,
 max_free_deliveries int not null default 0 check (max_free_deliveries between 0 and 100000),
 per_customer_limit int not null default 1 check (per_customer_limit between 0 and 20),
 courier_pay_egp int check (courier_pay_egp is null or courier_pay_egp between 0 and 500),
 budget_cap_egp int not null default 0 check (budget_cap_egp between 0 and 10000000),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
insert into public.delivery_promo(id) values (1) on conflict (id) do nothing;
alter table public.delivery_promo enable row level security;
revoke all on public.delivery_promo from public, anon, authenticated;

alter table public.delivery_requests add column if not exists list_fee_egp int not null default 0 check (list_fee_egp between 0 and 500);
alter table public.delivery_requests add column if not exists promo_applied boolean not null default false;
alter table public.delivery_requests add column if not exists courier_pay_egp int check (courier_pay_egp is null or courier_pay_egp between 0 and 500);
alter table public.delivery_requests drop constraint if exists delivery_requests_customer_fee_egp_check;
alter table public.delivery_requests drop constraint if exists delivery_fee_matches_promo;
alter table public.delivery_requests add constraint delivery_fee_matches_promo check (customer_fee_egp = case when promo_applied then 0 else list_fee_egp end) not valid;
create index if not exists delivery_requests_promo_idx on public.delivery_requests(promo_applied, status);

create or replace function public.place_delivery_request(p_pickup text, p_dropoff text, p_what text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int; v_cfg public.delivery_promo%rowtype;
 v_free boolean := false; v_n int; v_spent int; v_cust int; v_addr int; v_drop text := trim(p_dropoff);
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if (select role from public.profiles where id = v_uid) is distinct from 'customer' then
 raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if;
 if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms')
 and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
 raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
 select count(*) into v_open from public.delivery_requests where customer_id = v_uid and status in ('new','assigned','picked_up');
 if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if;
 select count(*) into v_recent from public.delivery_requests where customer_id = v_uid and created_at > now() - interval '1 hour';
 if v_recent >= 6 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400'; end if;
 select * into v_cfg from public.delivery_promo where id = 1 for update; -- serialises the cap check
 if v_cfg.enabled and v_cfg.courier_pay_egp is not null and v_cfg.max_free_deliveries > 0 and v_cfg.budget_cap_egp > 0
 and (v_cfg.starts_at is null or now() >= v_cfg.starts_at) and (v_cfg.ends_at is null or now() < v_cfg.ends_at) then
 select count(*), coalesce(sum(courier_pay_egp),0) into v_n, v_spent from public.delivery_requests where promo_applied and status <> 'cancelled';
 select count(*) into v_cust from public.delivery_requests where promo_applied and status <> 'cancelled' and customer_id = v_uid;
 select count(*) into v_addr from public.delivery_requests where promo_applied and status <> 'cancelled' and lower(regexp_replace(dropoff_address,'\s+',' ','g')) = lower(regexp_replace(v_drop,'\s+',' ','g'));
 if v_n < v_cfg.max_free_deliveries and v_spent + v_cfg.courier_pay_egp <= v_cfg.budget_cap_egp
 and v_cust < v_cfg.per_customer_limit and v_addr < v_cfg.per_customer_limit then v_free := true; end if;
 end if;
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (v_uid, trim(p_pickup), v_drop, trim(p_what), v_cfg.list_fee_egp, v_free, case when v_free then 0 else v_cfg.list_fee_egp end, case when v_free then v_cfg.courier_pay_egp else null end)
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.place_delivery_request(text,text,text) from public, anon;
grant execute on function public.place_delivery_request(text,text,text) to authenticated;

create or replace function public.admin_set_delivery_promo(p_enabled boolean, p_list_fee int, p_starts timestamptz, p_ends timestamptz, p_max_free int, p_per_customer int, p_courier_pay int, p_budget int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
 raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501'; end if;
 if p_enabled and (p_courier_pay is null or p_max_free is null or p_max_free < 1 or p_budget is null or p_budget < p_courier_pay or p_per_customer is null or p_per_customer < 1 or (p_ends is null and p_max_free is null)) then
 raise exception 'لتفعيل العرض لازم تحدد أجر المندوب وعدد التوصيلات المجانية والميزانية والحد لكل عميل' using errcode = '22023'; end if;
 if p_ends is not null and p_starts is not null and p_ends <= p_starts then raise exception 'تاريخ النهاية قبل البداية' using errcode = '22023'; end if;
 update public.delivery_promo set enabled = coalesce(p_enabled,false), list_fee_egp = coalesce(p_list_fee, list_fee_egp), starts_at = p_starts, ends_at = p_ends,
 max_free_deliveries = coalesce(p_max_free,0), per_customer_limit = coalesce(p_per_customer,1), courier_pay_egp = p_courier_pay, budget_cap_egp = coalesce(p_budget,0), updated_by = v_uid, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_set_delivery_promo(boolean,int,timestamptz,timestamptz,int,int,int,int) from public, anon;
grant execute on function public.admin_set_delivery_promo(boolean,int,timestamptz,timestamptz,int,int,int,int) to authenticated;

create or replace function public.admin_delivery_promo_status()
returns table(out_enabled boolean, out_open boolean, out_list_fee int, out_ends_at timestamptz, out_free_used int, out_free_max int, out_delivered_free int, out_committed_egp int, out_budget_egp int, out_remaining_egp int, out_per_customer int)
language plpgsql security definer set search_path = '' as $$
declare c public.delivery_promo%rowtype; n int; d int; s int;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select * into c from public.delivery_promo where id = 1;
 select count(*), count(*) filter (where status='delivered'), coalesce(sum(courier_pay_egp),0) into n, d, s from public.delivery_requests where promo_applied and status <> 'cancelled';
 return query select c.enabled,
 (c.enabled and c.courier_pay_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at) and n < c.max_free_deliveries and s + c.courier_pay_egp <= c.budget_cap_egp),
 c.list_fee_egp, c.ends_at, n, c.max_free_deliveries, d, s, c.budget_cap_egp, greatest(c.budget_cap_egp - s, 0), c.per_customer_limit;
end $$;
revoke all on function public.admin_delivery_promo_status() from public, anon;
grant execute on function public.admin_delivery_promo_status() to authenticated;

-- Public banner state: only whether the promo is open and the list fee. No counts or budget.
create or replace function public.delivery_promo_public()
returns table(out_open boolean, out_list_fee int, out_ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select (c.enabled and c.courier_pay_egp is not null and (c.starts_at is null or now() >= c.starts_at) and (c.ends_at is null or now() < c.ends_at)
 and (select count(*) from public.delivery_requests where promo_applied and status <> 'cancelled') < c.max_free_deliveries
 and (select coalesce(sum(courier_pay_egp),0) from public.delivery_requests where promo_applied and status <> 'cancelled') + c.courier_pay_egp <= c.budget_cap_egp),
 c.list_fee_egp, c.ends_at from public.delivery_promo c where c.id = 1;
$$;
revoke all on function public.delivery_promo_public() from public;
grant execute on function public.delivery_promo_public() to anon, authenticated;
