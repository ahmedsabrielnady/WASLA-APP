-- wasla-test ONLY. Draft free-delivery request flow (original requirement 5). NOT a production migration.
-- Owner decisions still open (docs/10): who pays the courier, minimum order, service area, cancellation terms.
-- Customer fee is pinned to 0 by a CHECK so the UI can promise free delivery without any money handling.
create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_id uuid not null references public.profiles(id),
  pickup_address text not null check (char_length(pickup_address) between 4 and 255),
  dropoff_address text not null check (char_length(dropoff_address) between 4 and 255),
  what_to_deliver text not null check (char_length(what_to_deliver) between 2 and 300),
  customer_fee_egp int not null default 0 check (customer_fee_egp = 0),
  status text not null default 'new' check (status in ('new','assigned','picked_up','delivered','cancelled')),
  courier_id uuid references public.providers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists delivery_requests_customer_idx on public.delivery_requests(customer_id, created_at desc);
alter table public.delivery_requests enable row level security;
create policy delivery_select on public.delivery_requests for select to authenticated using (
  customer_id = (select auth.uid())
  or public.is_staff()
  or courier_id in (select id from public.providers where user_id = (select auth.uid()))
);
grant select on public.delivery_requests to authenticated;

create or replace function public.place_delivery_request(p_pickup text, p_dropoff text, p_what text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  if (select role from public.profiles where id = v_uid) is distinct from 'customer' then
    raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if;
  select count(*) into v_open from public.delivery_requests
   where customer_id = v_uid and status in ('new','assigned','picked_up');
  if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if;
  insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver)
  values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.assign_delivery(p_request uuid, p_courier uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(),false) then raise exception 'غير مصرح' using errcode='42501'; end if;
  if not exists(select 1 from public.providers where id=p_courier and kind='courier' and approved and active) then
    raise exception 'المندوب غير معتمد أو غير نشط' using errcode='22023'; end if;
  update public.delivery_requests set courier_id=p_courier, status='assigned', updated_at=now()
   where id=p_request and status='new';
  if not found then raise exception 'لا يمكن إسناد الطلب في حالته الحالية' using errcode='22023'; end if;
end $$;

create or replace function public.courier_set_delivery_status(p_request uuid, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_row public.delivery_requests%rowtype;
begin
  if p_to not in ('picked_up','delivered') then raise exception 'الحالة غير مسموحة' using errcode='22023'; end if;
  select id into v_me from public.providers where user_id=(select auth.uid()) and kind='courier' and approved and active;
  if v_me is null then raise exception 'مندوب غير معتمد' using errcode='42501'; end if;
  select * into v_row from public.delivery_requests where id=p_request for update;
  if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;
  if v_row.courier_id is distinct from v_me then raise exception 'الطلب غير مسند إليك' using errcode='42501'; end if;
  if not ((v_row.status='assigned' and p_to='picked_up') or (v_row.status='picked_up' and p_to='delivered')) then
    raise exception 'انتقال الحالة غير مسموح' using errcode='22023'; end if;
  update public.delivery_requests set status=p_to, updated_at=now() where id=p_request;
end $$;

create or replace function public.customer_cancel_delivery(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.delivery_requests set status='cancelled', updated_at=now()
   where id=p_request and customer_id=(select auth.uid()) and status='new';
  if not found then raise exception 'يمكن إلغاء الطلب قبل إسناده فقط' using errcode='42501'; end if;
end $$;

revoke all on function public.place_delivery_request(text,text,text), public.assign_delivery(uuid,uuid),
  public.courier_set_delivery_status(uuid,text), public.customer_cancel_delivery(uuid) from public, anon;
grant execute on function public.place_delivery_request(text,text,text), public.assign_delivery(uuid,uuid),
  public.courier_set_delivery_status(uuid,text), public.customer_cancel_delivery(uuid) to authenticated;
