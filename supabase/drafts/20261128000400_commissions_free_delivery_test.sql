-- wasla-test ONLY. Draft, not a production migration. Records platform commissions (store 2% of the order total, clinic 10 EGP per consultation) when an order is marked done.
-- Nothing here moves money: it is an accrual ledger. Collection method is an open owner decision. Rates live in one config row.
create table if not exists public.platform_commission_config (
  id int primary key default 1 check (id = 1),
  store_rate_bp int not null default 200 check (store_rate_bp between 0 and 5000),
  clinic_fee_egp int not null default 10 check (clinic_fee_egp between 0 and 1000),
  updated_at timestamptz not null default now()
);
insert into public.platform_commission_config(id) values (1) on conflict (id) do nothing;
alter table public.platform_commission_config enable row level security;
revoke all on public.platform_commission_config from public, anon, authenticated;

create table if not exists public.platform_commission (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  kind text not null check (kind in ('store','clinic')),
  provider_id uuid,
  base_egp int not null check (base_egp >= 0),
  rate_bp int,
  commission_egp int not null check (commission_egp >= 0),
  created_at timestamptz not null default now()
);
alter table public.platform_commission enable row level security;
revoke all on public.platform_commission from public, anon, authenticated;

create or replace function public.accrue_platform_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.platform_commission_config%rowtype; v_amt int;
begin
  if new.status is distinct from 'done' or old.status is not distinct from 'done' then return new; end if;
  select * into c from public.platform_commission_config where id = 1;
  if new.sector = 'store' and coalesce(new.price_egp,0) > 0 then
    v_amt := (new.price_egp * c.store_rate_bp + 5000) / 10000;
    insert into public.platform_commission(order_id, kind, provider_id, base_egp, rate_bp, commission_egp) values (new.id, 'store', new.provider_id, new.price_egp, c.store_rate_bp, v_amt) on conflict (order_id) do nothing;
  elsif new.sector = 'clinic' then
    insert into public.platform_commission(order_id, kind, provider_id, base_egp, rate_bp, commission_egp) values (new.id, 'clinic', new.provider_id, coalesce(new.price_egp,0), null, c.clinic_fee_egp) on conflict (order_id) do nothing;
  end if;
  return new;
exception when others then
  return new; -- never block an order status change because of the ledger
end $$;
revoke all on function public.accrue_platform_commission() from public, anon, authenticated;
drop trigger if exists orders_accrue_commission on public.orders;
create trigger orders_accrue_commission after update of status on public.orders for each row execute function public.accrue_platform_commission();

create or replace function public.staff_commission_summary() returns table(out_kind text, out_orders int, out_base_egp bigint, out_commission_egp bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select k.kind, count(c.id)::int, coalesce(sum(c.base_egp),0)::bigint, coalesce(sum(c.commission_egp),0)::bigint
    from (values ('store'),('clinic')) k(kind) left join public.platform_commission c on c.kind = k.kind group by k.kind order by k.kind;
end $$;
revoke all on function public.staff_commission_summary() from public, anon;
grant execute on function public.staff_commission_summary() to authenticated;

-- TEST free-delivery trial settings (owner approval relayed 28 Nov 02:41, TEST only). per_customer_limit 5 is a placeholder, not confirmed.
update public.delivery_promo set enabled = true, list_fee_egp = 10, max_free_deliveries = 200, per_customer_limit = 5, budget_cap_egp = 3500, starts_at = null, ends_at = null where id = 1;
