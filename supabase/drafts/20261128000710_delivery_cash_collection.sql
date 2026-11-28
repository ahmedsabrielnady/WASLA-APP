-- wasla-test ONLY. Draft. Delivery fee collection: cash to the courier first, courier remittance to Wasla, ready for online payment later.
-- The customer pays Wasla, and the courier is Wasla's own. The amount due is the snapshotted customer_fee_egp (free promo deliveries owe 0 and get no row).
-- The outside-Shibin customer price is NOT decided; this only collects whatever customer_fee_egp the order was placed with.

create table if not exists public.delivery_remittances (
 id uuid primary key default gen_random_uuid(),
 courier_id uuid not null references public.providers(id),
 amount_egp int not null check (amount_egp >= 0),
 note text, created_by uuid, created_at timestamptz not null default now()
);
create table if not exists public.delivery_payments (
 delivery_id uuid primary key references public.delivery_requests(id),
 courier_id uuid references public.providers(id),
 method text not null default 'cash_courier' check (method in ('cash_courier','online')),
 amount_due_egp int not null check (amount_due_egp > 0),
 status text not null default 'pending' check (status in ('pending','collected','not_collected','waived')),
 collected_egp int check (collected_egp is null or collected_egp between 0 and 5000),
 collected_at timestamptz, recorded_by uuid, note text,
 remittance_id uuid references public.delivery_remittances(id),
 provider text, provider_ref text, paid_at timestamptz, -- reserved for online payment: a webhook fills these later
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.delivery_remittances enable row level security;
alter table public.delivery_payments enable row level security;
revoke all on public.delivery_remittances, public.delivery_payments from public, anon, authenticated;

-- when a delivery is marked delivered and a fee is owed, a pending cash row is created for its courier
create or replace function public.delivery_payment_on_delivered() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status = 'delivered' and old.status is distinct from 'delivered' and coalesce(new.customer_fee_egp,0) > 0 then
  insert into public.delivery_payments(delivery_id, courier_id, amount_due_egp) values (new.id, new.courier_id, new.customer_fee_egp) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists delivery_payment_on_delivered on public.delivery_requests;
create trigger delivery_payment_on_delivered after update of status on public.delivery_requests for each row execute function public.delivery_payment_on_delivered();

create or replace function public._me_courier() returns uuid language sql stable security definer set search_path = '' as $$
 select id from public.providers where user_id = (select auth.uid()) and kind = 'courier' and approved and active;
$$;
revoke all on function public._me_courier() from public, anon, authenticated;

-- the courier records what happened, once. A different amount or a no-collection needs a note.
create or replace function public.courier_record_collection(p_delivery uuid, p_collected boolean, p_amount int default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._me_courier(); p public.delivery_payments%rowtype; v_amt int; v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
 if v_me is null then raise exception 'مندوب غير معتمد' using errcode='42501'; end if;
 select * into p from public.delivery_payments where delivery_id = p_delivery for update;
 if not found then raise exception 'لا يوجد مبلغ مستحق لهذا الطلب' using errcode='P0002'; end if;
 if p.courier_id is distinct from v_me then raise exception 'الطلب غير مسند إليك' using errcode='42501'; end if;
 if p.method <> 'cash_courier' then raise exception 'هذا الطلب مدفوع إلكترونيًا' using errcode='22023'; end if;
 if p.status <> 'pending' then raise exception 'تم تسجيل التحصيل بالفعل، التعديل من فريق وصلة' using errcode='22023'; end if;
 if coalesce(p_collected,false) then
  v_amt := coalesce(p_amount, p.amount_due_egp);
  if v_amt < 0 or v_amt > 5000 then raise exception 'المبلغ غير صحيح' using errcode='22023'; end if;
  if v_amt <> p.amount_due_egp and (v_note is null or char_length(v_note) < 3) then raise exception 'المبلغ مختلف عن المستحق، اكتب السبب' using errcode='22023'; end if;
  update public.delivery_payments set status='collected', collected_egp=v_amt, collected_at=now(), recorded_by=(select auth.uid()), note=v_note, updated_at=now() where delivery_id=p_delivery;
 else
  if v_note is null or char_length(v_note) < 3 then raise exception 'اكتب سبب عدم التحصيل' using errcode='22023'; end if;
  update public.delivery_payments set status='not_collected', collected_egp=0, collected_at=now(), recorded_by=(select auth.uid()), note=v_note, updated_at=now() where delivery_id=p_delivery;
 end if;
end $$;
revoke all on function public.courier_record_collection(uuid,boolean,int,text) from public, anon;
grant execute on function public.courier_record_collection(uuid,boolean,int,text) to authenticated;

-- courier: own cash position
create or replace function public.courier_cash_summary()
returns table(out_pending int, out_holding_egp int, out_remitted_egp int, out_not_collected int)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._me_courier();
begin
 if v_me is null then raise exception 'مندوب غير معتمد' using errcode='42501'; end if;
 return query select
  (count(*) filter (where status='pending' and method='cash_courier'))::int,
  coalesce(sum(collected_egp) filter (where status='collected' and method='cash_courier' and remittance_id is null),0)::int,
  coalesce(sum(collected_egp) filter (where status='collected' and method='cash_courier' and remittance_id is not null),0)::int,
  (count(*) filter (where status='not_collected'))::int
 from public.delivery_payments where courier_id = v_me;
end $$;
revoke all on function public.courier_cash_summary() from public, anon;
grant execute on function public.courier_cash_summary() to authenticated;

create or replace function public.courier_my_collections()
returns table(out_delivery uuid, out_ref text, out_due int, out_status text, out_collected int, out_remitted boolean, out_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._me_courier();
begin
 if v_me is null then raise exception 'مندوب غير معتمد' using errcode='42501'; end if;
 return query select p.delivery_id, r.ref, p.amount_due_egp, p.status, p.collected_egp, p.remittance_id is not null, p.created_at
  from public.delivery_payments p join public.delivery_requests r on r.id = p.delivery_id where p.courier_id = v_me order by p.created_at desc limit 50;
end $$;
revoke all on function public.courier_my_collections() from public, anon;
grant execute on function public.courier_my_collections() to authenticated;

-- staff: who holds what
create or replace function public.staff_cash_ledger()
returns table(out_courier uuid, out_name text, out_pending int, out_holding_egp int, out_remitted_egp int, out_not_collected int, out_waived int)
language plpgsql security definer set search_path = '' as $$
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 return query select p.courier_id, coalesce(max(v.display_name),'مندوب'),
  (count(*) filter (where p.status='pending' and p.method='cash_courier'))::int,
  coalesce(sum(p.collected_egp) filter (where p.status='collected' and p.method='cash_courier' and p.remittance_id is null),0)::int,
  coalesce(sum(p.collected_egp) filter (where p.status='collected' and p.method='cash_courier' and p.remittance_id is not null),0)::int,
  (count(*) filter (where p.status='not_collected'))::int, (count(*) filter (where p.status='waived'))::int
 from public.delivery_payments p left join public.providers v on v.id = p.courier_id group by p.courier_id order by 4 desc;
end $$;
revoke all on function public.staff_cash_ledger() from public, anon;
grant execute on function public.staff_cash_ledger() to authenticated;

-- staff: the courier hands over cash. The amount must equal what the ledger says the courier holds, so nothing is silently short.
create or replace function public.staff_record_remittance(p_courier uuid, p_amount int, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hold int; v_id uuid;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select coalesce(sum(collected_egp),0) into v_hold from public.delivery_payments where courier_id = p_courier and status='collected' and method='cash_courier' and remittance_id is null;
 if v_hold <= 0 then raise exception 'لا يوجد مبلغ معلق عند هذا المندوب' using errcode='22023'; end if;
 if p_amount is distinct from v_hold then raise exception 'المبلغ لا يطابق المعلق عند المندوب (%)', v_hold using errcode='22023'; end if;
 insert into public.delivery_remittances(courier_id, amount_egp, note, created_by) values (p_courier, v_hold, nullif(trim(coalesce(p_note,'')),''), (select auth.uid())) returning id into v_id;
 update public.delivery_payments set remittance_id = v_id, updated_at = now() where courier_id = p_courier and status='collected' and method='cash_courier' and remittance_id is null;
 return v_id;
end $$;
revoke all on function public.staff_record_remittance(uuid,int,text) from public, anon;
grant execute on function public.staff_record_remittance(uuid,int,text) to authenticated;

-- staff: fix a pending/not collected/collected row before remittance, or waive it (note required)
create or replace function public.staff_resolve_collection(p_delivery uuid, p_status text, p_amount int default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.delivery_payments%rowtype; v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 if p_status not in ('collected','not_collected','waived') then raise exception 'حالة غير صحيحة' using errcode='22023'; end if;
 if v_note is null or char_length(v_note) < 3 then raise exception 'اكتب السبب' using errcode='22023'; end if;
 select * into p from public.delivery_payments where delivery_id = p_delivery for update;
 if not found then raise exception 'لا يوجد مبلغ مستحق' using errcode='P0002'; end if;
 if p.remittance_id is not null then raise exception 'تم توريد هذا المبلغ، لا يمكن تعديله' using errcode='22023'; end if;
 update public.delivery_payments set status = p_status, collected_egp = case p_status when 'collected' then coalesce(p_amount, p.amount_due_egp) else 0 end,
  collected_at = now(), recorded_by = (select auth.uid()), note = v_note, updated_at = now() where delivery_id = p_delivery;
end $$;
revoke all on function public.staff_resolve_collection(uuid,text,int,text) from public, anon;
grant execute on function public.staff_resolve_collection(uuid,text,int,text) to authenticated;
