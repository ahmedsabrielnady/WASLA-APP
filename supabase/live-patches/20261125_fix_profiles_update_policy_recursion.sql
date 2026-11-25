-- Archive of the live production patch applied on 2026-11-25.
-- Fixes recursive self-reference in public.profiles.profiles_update_own.
-- The helper is placed in a non-public schema and returns only the caller's own role.

create schema if not exists private;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
$function$;

revoke all on function private.current_profile_role() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_profile_role() to authenticated;

drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = (select private.current_profile_role())
);
