-- wasla-test ONLY. Draft. Applies after wasla-draft-delivery-cash-collection.sql and the zone-by-pin draft.
-- Figures below are the ones relayed by main on Nov 27 as the owner's current answers (not verified here): customer pays 35 outside Shibin and 10 inside after the free period; courier pay 33 outside and 18 inside; the courier collects cash BEFORE moving.
-- Outside Wasla keeps 2 per delivery; inside Wasla subsidises 8 per delivery (10 - 18). TEST only, values are config, not law.
alter table public.delivery_promo add column if not exists customer_fee_outside_egp int not null default 35 check (customer_fee_outside_egp between 0 and 500);
update public.delivery_promo set list_fee_egp = 10, customer_fee_outside_egp = 35, courier_pay_inside_egp = 18, courier_pay_outside_egp = 33 where id = 1;
alter table public.delivery_requests add column if not exists platform_share_egp int check (platform_share_egp is null or platform_share_egp between -500 and 500);
alter table public.delivery_payments add column if not exists courier_pay_egp int, add column if not exists platform_share_egp int;

-- customer fee follows the zone (inside: placeholder list fee; outside: 35). Courier pay stays the zone snapshot (18 / 33).
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
 return query select v_free, case when v_zone = 'inside' then v_cfg.list_fee_egp else v_cfg.customer_fee_outside_egp end, v_pay, case when v_pay is null then null else v_zone end, v_pa;
end $$;
revoke all on function public._delivery_decision(uuid,text,text,text) from public, anon, authenticated;

-- Wasla share per paid delivery = customer fee minus courier pay: +2 outside (35/33), -8 inside (10/18, a subsidy). Free promo deliveries have no customer fee, so no share (Wasla pays the courier).
create or replace function public.delivery_set_platform_share() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
  new.platform_share_egp := case when new.promo_applied or coalesce(new.customer_fee_egp,0) = 0 or new.courier_pay_egp is null then 0 else new.customer_fee_egp - new.courier_pay_egp end;
 end if;
 return new;
end $$;
drop trigger if exists delivery_set_platform_share on public.delivery_requests;
create trigger delivery_set_platform_share before insert on public.delivery_requests for each row execute function public.delivery_set_platform_share();

-- the cash row is created when the courier picks up (cash is collected before moving). Delivered stays as a fallback for rows missed.
create or replace function public.delivery_payment_on_delivered() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status in ('picked_up','delivered') and old.status is distinct from new.status and coalesce(new.customer_fee_egp,0) > 0 then
  insert into public.delivery_payments(delivery_id, courier_id, amount_due_egp, courier_pay_egp, platform_share_egp)
  values (new.id, new.courier_id, new.customer_fee_egp, new.courier_pay_egp, new.platform_share_egp) on conflict do nothing;
 end if;
 return new;
end $$;

-- a delivery cannot be marked delivered while its cash is still pending (collected, not collected with a reason, or waived by staff first)
create or replace function public.delivery_block_delivered_pending_cash() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status = 'delivered' and old.status is distinct from 'delivered' and exists (select 1 from public.delivery_payments where delivery_id = new.id and status = 'pending') then
  raise exception 'سجّل التحصيل أولًا قبل تسليم الطلب' using errcode='22023';
 end if;
 return new;
end $$;
drop trigger if exists delivery_block_delivered_pending_cash on public.delivery_requests;
create trigger delivery_block_delivered_pending_cash before update of status on public.delivery_requests for each row execute function public.delivery_block_delivered_pending_cash();

-- staff ledger gains Wasla's share on collected rows
drop function if exists public.staff_cash_ledger();
create or replace function public.staff_cash_ledger()
returns table(out_courier uuid, out_name text, out_pending int, out_holding_egp int, out_remitted_egp int, out_not_collected int, out_waived int, out_courier_pay_egp int, out_platform_share_egp int, out_subsidy_egp int)
language plpgsql security definer set search_path = '' as $$
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 return query select p.courier_id, coalesce(max(v.display_name),'مندوب'),
  (count(*) filter (where p.status='pending' and p.method='cash_courier'))::int,
  coalesce(sum(p.collected_egp) filter (where p.status='collected' and p.method='cash_courier' and p.remittance_id is null),0)::int,
  coalesce(sum(p.collected_egp) filter (where p.status='collected' and p.method='cash_courier' and p.remittance_id is not null),0)::int,
  (count(*) filter (where p.status='not_collected'))::int, (count(*) filter (where p.status='waived'))::int,
  coalesce(sum(p.courier_pay_egp) filter (where p.status='collected'),0)::int, coalesce(sum(p.platform_share_egp) filter (where p.status='collected'),0)::int, coalesce(-sum(p.platform_share_egp) filter (where p.status='collected' and p.platform_share_egp < 0),0)::int
 from public.delivery_payments p left join public.providers v on v.id = p.courier_id group by p.courier_id order by 4 desc;
end $$;
revoke all on function public.staff_cash_ledger() from public, anon;
grant execute on function public.staff_cash_ledger() to authenticated;
