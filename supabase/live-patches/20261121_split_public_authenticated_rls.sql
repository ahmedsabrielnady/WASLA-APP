-- WASLA live database policy patch archive
-- Applied to Supabase project "wasla" as migration:
-- separate_public_and_authenticated_read_policies
--
-- Anonymous clients can read only intentionally public records. Any policy
-- that calls authenticated SECURITY DEFINER helpers is restricted to the
-- authenticated role to avoid anon permission-denied responses.

drop policy if exists consents_read on public.consents;
create policy consents_read on public.consents for select to authenticated
using (user_id = (select auth.uid()) or public.is_staff());

drop policy if exists invites_staff_read on public.invites;
create policy invites_staff_read on public.invites for select to authenticated
using (public.is_staff());

drop policy if exists notes_doctor_read on public.medical_notes;
create policy notes_doctor_read on public.medical_notes for select to authenticated
using (doctor_id = public.current_provider_id());

drop policy if exists notes_doctor_write on public.medical_notes;
create policy notes_doctor_write on public.medical_notes for insert to authenticated
with check (
  doctor_id = public.current_provider_id()
  and exists (
    select 1 from public.orders o
    where o.customer_id = medical_notes.patient_id
      and o.provider_id = medical_notes.doctor_id
  )
);

drop policy if exists notes_patient_read on public.medical_notes;
create policy notes_patient_read on public.medical_notes for select to authenticated
using (patient_id = (select auth.uid()));

drop policy if exists events_read on public.order_events;
create policy events_read on public.order_events for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and (
        o.customer_id = (select auth.uid())
        or o.provider_id = public.current_provider_id()
        or public.is_staff()
      )
  )
);

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
using (
  customer_id = (select auth.uid())
  or provider_id = public.current_provider_id()
  or public.is_staff()
);

drop policy if exists offers_read on public.offers;
create policy offers_public_read on public.offers for select to anon using (active = true);
create policy offers_authenticated_read on public.offers for select to authenticated
using (active = true or public.is_staff());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
);

drop policy if exists products_read on public.products;
create policy products_public_read on public.products for select to anon
using (active = true and stock > 0);
create policy products_authenticated_read on public.products for select to authenticated
using (
  (active = true and stock > 0)
  or merchant_id = public.current_provider_id()
  or public.is_staff()
);

drop policy if exists products_merchant_write on public.products;
create policy products_merchant_write on public.products for all to authenticated
using (merchant_id = public.current_provider_id())
with check (merchant_id = public.current_provider_id());

drop policy if exists providers_read on public.providers;
create policy providers_public_read on public.providers for select to anon
using (approved = true and active = true);
create policy providers_authenticated_read on public.providers for select to authenticated
using (
  (approved = true and active = true)
  or user_id = (select auth.uid())
  or public.is_staff()
);

drop policy if exists schedules_read on public.provider_schedules;
create policy schedules_public_read on public.provider_schedules for select to anon
using (
  active = true
  and exists (
    select 1 from public.providers p
    where p.id = provider_schedules.provider_id
      and p.approved and p.active
  )
);
create policy schedules_authenticated_read on public.provider_schedules for select to authenticated
using (
  public.is_staff()
  or (
    active = true
    and exists (
      select 1 from public.providers p
      where p.id = provider_schedules.provider_id
        and p.approved and p.active
    )
  )
  or exists (
    select 1 from public.providers p
    where p.id = provider_schedules.provider_id
      and p.user_id = (select auth.uid())
  )
);
