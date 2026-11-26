-- SPLIT A (26 Nov): order/vehicle/clinic/contact locations. No dependency on delivery_requests. Delivery points are in the B file (needs 20261125000100).
-- wasla-test ONLY. Draft: precise location for orders, vehicle details, clinic locations and delivery points. NOT a production migration.
-- Privacy design: exact coordinates live in separate tables, readable only by the owner, the provider assigned to that order while it is active, and staff.
-- orders.lat/lng are legacy: a trigger now forces them to NULL so a provider can no longer read coordinates through orders_read.

-- 1) Stop storing coordinates on orders (the assigned provider can read the whole orders row).
update public.orders set lat = null, lng = null where lat is not null or lng is not null;
create or replace function public.orders_strip_coordinates() returns trigger language plpgsql set search_path = '' as $$
begin new.lat := null; new.lng := null; return new; end $$;
revoke execute on function public.orders_strip_coordinates() from public, anon, authenticated;
drop trigger if exists orders_strip_coordinates on public.orders;
create trigger orders_strip_coordinates before insert or update on public.orders
 for each row execute function public.orders_strip_coordinates();

-- 2) Order location (one per order).
create table if not exists public.order_locations (
 order_id uuid primary key references public.orders(id) on delete cascade,
 lat double precision not null check (lat between -90 and 90),
 lng double precision not null check (lng between -180 and 180),
 accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 100000),
 landmark text check (landmark is null or char_length(landmark) <= 200),
 contact_phone text check (contact_phone is null or contact_phone ~ '^01[0-9]{9}$'),
 consent_at timestamptz not null,
 captured_at timestamptz not null default now()
);
alter table public.order_locations enable row level security;
create policy order_locations_owner_read on public.order_locations for select to authenticated using (
 exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
);
create policy order_locations_staff_read on public.order_locations for select to authenticated using (public.is_staff());
grant select on public.order_locations to authenticated;
-- No direct writes. The assigned provider reads only through provider_get_order_location.

-- 3) Vehicle details (car sector orders).
create table if not exists public.order_vehicle_details (
 order_id uuid primary key references public.orders(id) on delete cascade,
 make text not null check (char_length(make) between 1 and 40),
 model text not null check (char_length(model) between 1 and 40),
 plate text not null check (char_length(plate) between 2 and 20),
 color text check (color is null or char_length(color) <= 30),
 created_at timestamptz not null default now()
);
alter table public.order_vehicle_details enable row level security;
create policy order_vehicle_owner_read on public.order_vehicle_details for select to authenticated using (
 exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
);
create policy order_vehicle_staff_read on public.order_vehicle_details for select to authenticated using (public.is_staff());
grant select on public.order_vehicle_details to authenticated;

-- 4) Clinic locations: a clinic address is a business address, so any signed-in user may read an approved, active, non-test doctor's location.
create table if not exists public.clinic_locations (
 provider_id uuid primary key references public.providers(id) on delete cascade,
 lat double precision not null check (lat between -90 and 90),
 lng double precision not null check (lng between -180 and 180),
 address text not null check (char_length(address) between 4 and 255),
 updated_at timestamptz not null default now()
);
alter table public.clinic_locations enable row level security;
create policy clinic_locations_read on public.clinic_locations for select to authenticated using (
 public.is_staff()
 or provider_id in (select id from public.providers where user_id = (select auth.uid()))
 or exists (select 1 from public.providers p where p.id = provider_id and p.kind = 'doctor' and p.approved and p.active and not p.is_test)
);
grant select on public.clinic_locations to authenticated;

-- Provider contact phone, set by the provider; shown to the customer only for an active assigned order.
create table if not exists public.provider_contacts (
 provider_id uuid primary key references public.providers(id) on delete cascade,
 phone text not null check (phone ~ '^01[0-9]{9}$')
);
alter table public.provider_contacts enable row level security;
create policy provider_contacts_self on public.provider_contacts for select to authenticated using (
 provider_id in (select id from public.providers where user_id = (select auth.uid())) or public.is_staff());
grant select on public.provider_contacts to authenticated;


-- 6) RPCs.
create or replace function public.save_order_location(p_order uuid, p_lat double precision, p_lng double precision, p_accuracy integer, p_landmark text, p_contact_phone text, p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if p_consent is not true then raise exception 'لازم توافق على استخدام موقعك لإرسال مقدم الخدمة' using errcode='42501'; end if;
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
 raise exception 'الموقع غير صحيح' using errcode='22023'; end if;
 if not exists (select 1 from public.orders where id = p_order and customer_id = v_uid and status in ('new','quoted','confirmed')) then
 raise exception 'الطلب غير موجود أو لا يمكن تعديل موقعه الآن' using errcode='42501'; end if;
 insert into public.order_locations(order_id, lat, lng, accuracy_m, landmark, contact_phone, consent_at)
 values (p_order, p_lat, p_lng, p_accuracy, nullif(trim(coalesce(p_landmark,'')),''), nullif(trim(coalesce(p_contact_phone,'')),''), now())
 on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
 landmark = excluded.landmark, contact_phone = excluded.contact_phone, consent_at = excluded.consent_at, captured_at = now();
end $$;

create or replace function public.save_order_vehicle(p_order uuid, p_make text, p_model text, p_plate text, p_color text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if not exists (select 1 from public.orders where id = p_order and customer_id = v_uid and sector = 'car' and status in ('new','quoted','confirmed')) then
 raise exception 'طلب السيارة غير موجود أو لا يمكن تعديله الآن' using errcode='42501'; end if;
 insert into public.order_vehicle_details(order_id, make, model, plate, color)
 values (p_order, trim(p_make), trim(p_model), upper(trim(p_plate)), nullif(trim(coalesce(p_color,'')),''))
 on conflict (order_id) do update set make = excluded.make, model = excluded.model, plate = excluded.plate, color = excluded.color;
end $$;

-- The assigned provider sees the exact point, vehicle and customer phone only while the order is active.
create or replace function public.provider_get_order_location(p_order uuid)
returns table(out_lat double precision, out_lng double precision, out_landmark text, out_address text, out_customer_phone text,
 out_vehicle_make text, out_vehicle_model text, out_vehicle_plate text, out_vehicle_color text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_me uuid;
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 select id into v_me from public.providers where user_id = v_uid and approved and active;
 if v_me is null and not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 if not exists (select 1 from public.orders o where o.id = p_order and o.status not in ('done','cancelled')
 and (o.provider_id = v_me or coalesce(public.is_staff(), false))) then
 raise exception 'لا يوجد طلب نشط مسند إليك' using errcode='42501'; end if;
 return query
 select l.lat, l.lng, l.landmark, o.address, l.contact_phone, v.make, v.model, v.plate, v.color
 from public.orders o
 join public.order_locations l on l.order_id = o.id
 left join public.order_vehicle_details v on v.order_id = o.id
 where o.id = p_order;
end $$;

-- The customer can reach the assigned provider by phone while the order is active.
create or replace function public.customer_get_provider_contact(p_order uuid)
returns table(out_provider_name text, out_provider_phone text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 return query
 select p.display_name, pr.phone
 from public.orders o
 join public.providers p on p.id = o.provider_id
 left join public.provider_contacts pr on pr.provider_id = p.id
 where o.id = p_order and o.customer_id = v_uid and o.status not in ('done','cancelled');
end $$;

create or replace function public.provider_set_phone(p_phone text) returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid;
begin
 select id into v_me from public.providers where user_id = (select auth.uid()) and approved and active;
 if v_me is null then raise exception 'غير مصرح' using errcode='42501'; end if;
 if p_phone is null or p_phone !~ '^01[0-9]{9}$' then raise exception 'رقم الموبايل غير صحيح' using errcode='22023'; end if;
 insert into public.provider_contacts(provider_id, phone) values (v_me, p_phone) on conflict (provider_id) do update set phone = excluded.phone;
end $$;

create or replace function public.provider_set_clinic_location(p_lat double precision, p_lng double precision, p_address text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid;
begin
 select id into v_me from public.providers where user_id = (select auth.uid()) and kind = 'doctor' and approved and active;
 if v_me is null then raise exception 'متاح للأطباء المعتمدين فقط' using errcode='42501'; end if;
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
 raise exception 'الموقع غير صحيح' using errcode='22023'; end if;
 insert into public.clinic_locations(provider_id, lat, lng, address) values (v_me, p_lat, p_lng, trim(p_address))
 on conflict (provider_id) do update set lat = excluded.lat, lng = excluded.lng, address = excluded.address, updated_at = now();
end $$;


-- Retention: exact locations are deleted 30 days after the order is done or cancelled. Run by a scheduler (pg_cron or an Edge Function on a free cron); until one is set up this is a manual step.
create or replace function public.purge_expired_locations() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
 delete from public.order_locations l using public.orders o where o.id = l.order_id and o.status in ('done','cancelled') and o.updated_at < now() - interval '30 days';
 get diagnostics m = row_count; n := n + m;
 return n;
end $$;

-- Grants: nothing for anon or public; staff-only purge.
revoke execute on function public.save_order_location(uuid,double precision,double precision,integer,text,text,boolean) from public, anon;
revoke execute on function public.save_order_vehicle(uuid,text,text,text,text) from public, anon;
revoke execute on function public.provider_get_order_location(uuid) from public, anon;
revoke execute on function public.customer_get_provider_contact(uuid) from public, anon;
revoke execute on function public.provider_set_clinic_location(double precision,double precision,text) from public, anon;
revoke execute on function public.provider_set_phone(text) from public, anon;
revoke execute on function public.purge_expired_locations() from public, anon, authenticated;
grant execute on function public.save_order_location(uuid,double precision,double precision,integer,text,text,boolean) to authenticated;
grant execute on function public.save_order_vehicle(uuid,text,text,text,text) to authenticated;
grant execute on function public.provider_get_order_location(uuid) to authenticated;
grant execute on function public.customer_get_provider_contact(uuid) to authenticated;
grant execute on function public.provider_set_clinic_location(double precision,double precision,text) to authenticated;
grant execute on function public.provider_set_phone(text) to authenticated;
-- The legacy writer wrote coordinates onto orders; the trigger now nulls them, so close the RPC too.
do $g$ begin if to_regprocedure('public.set_order_location(uuid,double precision,double precision,text)') is not null then revoke execute on function public.set_order_location(uuid,double precision,double precision,text) from authenticated; end if; end $g$;

