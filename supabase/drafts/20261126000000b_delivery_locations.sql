-- SPLIT B (26 Nov): delivery points. Requires 20261125000100_delivery_requests and loc_A.
-- 5) Delivery points (pickup and drop-off).
create table if not exists public.delivery_request_locations (
 request_id uuid primary key references public.delivery_requests(id) on delete cascade,
 pickup_lat double precision not null check (pickup_lat between -90 and 90),
 pickup_lng double precision not null check (pickup_lng between -180 and 180),
 dropoff_lat double precision not null check (dropoff_lat between -90 and 90),
 dropoff_lng double precision not null check (dropoff_lng between -180 and 180),
 consent_at timestamptz not null,
 captured_at timestamptz not null default now()
);
alter table public.delivery_request_locations enable row level security;
create policy delivery_locations_owner_read on public.delivery_request_locations for select to authenticated using (
 exists (select 1 from public.delivery_requests d where d.id = request_id and d.customer_id = (select auth.uid()))
);
create policy delivery_locations_staff_read on public.delivery_request_locations for select to authenticated using (public.is_staff());
grant select on public.delivery_request_locations to authenticated;
create or replace function public.save_delivery_locations(p_request uuid, p_pickup_lat double precision, p_pickup_lng double precision,
 p_dropoff_lat double precision, p_dropoff_lng double precision, p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if p_consent is not true then raise exception 'لازم توافق على استخدام موقع الاستلام والتسليم' using errcode='42501'; end if;
 if least(p_pickup_lat, p_dropoff_lat) < -90 or greatest(p_pickup_lat, p_dropoff_lat) > 90
 or least(p_pickup_lng, p_dropoff_lng) < -180 or greatest(p_pickup_lng, p_dropoff_lng) > 180 then
 raise exception 'الموقع غير صحيح' using errcode='22023'; end if;
 if not exists (select 1 from public.delivery_requests where id = p_request and customer_id = v_uid and status = 'new') then
 raise exception 'طلب التوصيل غير موجود أو لا يمكن تعديله' using errcode='42501'; end if;
 insert into public.delivery_request_locations(request_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, consent_at)
 values (p_request, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, now())
 on conflict (request_id) do update set pickup_lat = excluded.pickup_lat, pickup_lng = excluded.pickup_lng,
 dropoff_lat = excluded.dropoff_lat, dropoff_lng = excluded.dropoff_lng, consent_at = excluded.consent_at, captured_at = now();
end $$;

create or replace function public.courier_get_delivery_locations(p_request uuid)
returns table(out_pickup_lat double precision, out_pickup_lng double precision, out_dropoff_lat double precision, out_dropoff_lng double precision)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid;
begin
 select id into v_me from public.providers where user_id = (select auth.uid()) and approved and active;
 if v_me is null and not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 if not exists (select 1 from public.delivery_requests d where d.id = p_request and d.status in ('assigned','picked_up')
 and (d.courier_id = v_me or coalesce(public.is_staff(), false))) then
 raise exception 'لا يوجد طلب توصيل نشط مسند إليك' using errcode='42501'; end if;
 return query
 select l.pickup_lat, l.pickup_lng, l.dropoff_lat, l.dropoff_lng
 from public.delivery_requests d join public.delivery_request_locations l on l.request_id = d.id where d.id = p_request;
end $$;

create or replace function public.purge_expired_locations() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
 delete from public.order_locations l using public.orders o where o.id = l.order_id and o.status in ('done','cancelled') and o.updated_at < now() - interval '30 days';
 get diagnostics m = row_count; n := n + m;
 delete from public.delivery_request_locations l using public.delivery_requests d where d.id = l.request_id and d.status in ('delivered','cancelled') and d.updated_at < now() - interval '30 days';
 get diagnostics m = row_count; n := n + m;
 return n;
end $$;

revoke execute on function public.save_delivery_locations(uuid,double precision,double precision,double precision,double precision,boolean) from public, anon;
revoke execute on function public.courier_get_delivery_locations(uuid) from public, anon;
grant execute on function public.save_delivery_locations(uuid,double precision,double precision,double precision,double precision,boolean) to authenticated;
grant execute on function public.courier_get_delivery_locations(uuid) to authenticated;
revoke execute on function public.purge_expired_locations() from public, anon, authenticated;
