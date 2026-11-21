-- WASLA live database patch archive
-- Applied to Supabase project "wasla" as migration:
-- isolate_test_providers_from_public_discovery
--
-- This patch tags clearly named demo providers without deleting them,
-- keeps their existing order history, and prevents public discovery,
-- clinic slot disclosure, booking, and new order assignment.

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

-- See docs/05-phase1-application-foundation-ar.md for the exact
-- replacement definitions of clinic_available_slots, book_clinic_slot,
-- and assign_order. They all reject providers where is_test = true.
