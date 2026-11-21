-- WASLA live database patch archive
-- Applied to Supabase project "wasla" as migration:
-- isolate_test_providers_from_public_discovery
--
-- Test provider records remain in the database. Their historical orders are
-- preserved, but the records are not publicly discoverable and cannot be
-- selected for new bookings or assignments.

alter table public.providers
  add column if not exists is_test boolean not null default false;

update public.providers
   set is_test = true
 where display_name ilike '%تجريبي%';

drop policy if exists providers_public_read on public.providers;
create policy providers_public_read
on public.providers
for select
to anon
using (approved = true and active = true and is_test = false);

drop policy if exists providers_authenticated_read on public.providers;
create policy providers_authenticated_read
on public.providers
for select
to authenticated
using (
  (approved = true and active = true and is_test = false)
  or user_id = (select auth.uid())
  or public.is_staff()
);

drop policy if exists schedules_public_read on public.provider_schedules;
create policy schedules_public_read
on public.provider_schedules
for select
to anon
using (
  active = true
  and exists (
    select 1 from public.providers p
    where p.id = provider_schedules.provider_id
      and p.approved = true and p.active = true and p.is_test = false
  )
);

drop policy if exists schedules_authenticated_read on public.provider_schedules;
create policy schedules_authenticated_read
on public.provider_schedules
for select
to authenticated
using (
  public.is_staff()
  or (
    active = true
    and exists (
      select 1 from public.providers p
      where p.id = provider_schedules.provider_id
        and p.approved = true and p.active = true and p.is_test = false
    )
  )
  or exists (
    select 1 from public.providers p
    where p.id = provider_schedules.provider_id
      and p.user_id = (select auth.uid())
  )
);

create or replace function public.clinic_available_slots(p_provider uuid, p_day date)
returns table(slot timestamp with time zone)
language sql
stable
security definer
set search_path to ''
as $function$
  select s.slot
  from (
    select
      (p_day + sc.start_time + (g * sc.slot_minutes || ' minutes')::interval)
      at time zone 'Africa/Cairo' as slot
    from public.provider_schedules sc
    cross join lateral generate_series(
      0,
      (extract(epoch from (sc.end_time - sc.start_time))::int / 60 / sc.slot_minutes) - 1
    ) g
    where sc.provider_id = p_provider
      and sc.active
      and sc.weekday = extract(dow from p_day)::int
  ) s
  where s.slot > pg_catalog.now()
    and exists (
      select 1
      from public.providers p
      where p.id = p_provider
        and p.kind = 'doctor'
        and p.approved = true
        and p.active = true
        and p.is_test = false
    )
    and not exists (
      select 1
      from public.orders o
      where o.provider_id = p_provider
        and o.scheduled_at = s.slot
        and o.status <> 'cancelled'
    )
  order by s.slot;
$function$;

create or replace function public.book_clinic_slot(
  p_provider uuid,
  p_at timestamp with time zone,
  p_notes text default null,
  p_source text default 'web'
)
returns table(
  out_order_id uuid,
  out_ref text,
  out_price_egp integer,
  out_scheduled_at timestamp with time zone
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_item public.service_items%rowtype;
  v_id uuid;
  v_ref text;
  v_recent integer;
  v_src text := case when p_source in ('web','app') then p_source else 'web' end;
begin
  if v_uid is null then
    raise exception 'سجل دخولك الأول' using errcode = '28000';
  end if;

  if not (
    exists (select 1 from public.consents where user_id = v_uid and kind = 'terms')
    and exists (select 1 from public.consents where user_id = v_uid and kind = 'privacy')
  ) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode = '42501';
  end if;

  select count(*) into v_recent
  from public.orders
  where customer_id = v_uid
    and created_at > pg_catalog.now() - interval '10 minutes';

  if v_recent >= 5 then
    raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode = '53400';
  end if;

  if not exists (
    select 1
    from public.providers
    where id = p_provider
      and kind = 'doctor'
      and approved = true
      and active = true
      and is_test = false
  ) then
    raise exception 'الدكتور ده مش متاح للحجز' using errcode = '22023';
  end if;

  select * into v_item
  from public.service_items
  where sector = 'clinic' and active
  order by id
  limit 1;

  if not found then
    raise exception 'خدمة الكشف مش متاحة' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.clinic_available_slots(p_provider, (p_at at time zone 'Africa/Cairo')::date) s
    where s.slot = p_at
  ) then
    raise exception 'الموعد ده مش متاح، اختار موعد تاني' using errcode = '22023';
  end if;

  insert into public.orders (
    customer_id,provider_id,sector,item_id,address,notes,price_egp,
    deposit_egp,source,scheduled_at
  )
  values (
    v_uid,p_provider,'clinic',v_item.id,'في العيادة',
    nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),
    v_item.price_egp,0,v_src,p_at
  )
  returning id,ref into v_id,v_ref;

  insert into public.order_events (
    order_id,actor_id,from_status,to_status,note
  )
  values (v_id,v_uid,null,'new','تم حجز موعد العيادة');

  return query select v_id,v_ref,v_item.price_egp,p_at;

exception
  when unique_violation then
    raise exception 'الموعد اتحجز قبل ما تخلص، اختار موعد تاني' using errcode = '23505';
end;
$function$;

create or replace function public.assign_order(p_order uuid,p_provider uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_prov public.providers%rowtype;
  v_ok boolean;
begin
  if not public.is_staff() then
    raise exception 'مسموح للسكرتارية بس' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = p_order;

  select * into v_prov
  from public.providers
  where id = p_provider;

  if not found
     or v_prov.approved is not true
     or v_prov.active is not true
     or v_prov.is_test is true then
    raise exception 'مقدم الخدمة مش معتمد أو غير نشط' using errcode = '42501';
  end if;

  v_ok := case v_order.sector
    when 'nursing' then v_prov.kind in ('doctor','technician')
    when 'maintenance' then v_prov.kind = 'technician'
    when 'car' then v_prov.kind = 'technician'
    when 'education' then v_prov.kind = 'teacher'
    when 'delivery' then v_prov.kind = 'courier'
    when 'food' then v_prov.kind in ('merchant','courier')
    else false
  end;

  if not v_ok then
    raise exception 'نوع مقدم الخدمة ده مش مناسب للطلب' using errcode = '22023';
  end if;

  update public.orders
     set provider_id = p_provider,
         updated_at = pg_catalog.now()
   where id = p_order;

  insert into public.order_events(order_id,actor_id,from_status,to_status,note)
  values(p_order,auth.uid(),null,'assigned','تم تعيين مقدم الخدمة');
end;
$function$;
