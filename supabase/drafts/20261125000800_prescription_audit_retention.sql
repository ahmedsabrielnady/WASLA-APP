-- wasla-test ONLY draft (0800). Audit log, audited read authorization, retention candidates. Non-breaking: existing direct storage reads keep working until draft 0801 is applied.
create table if not exists public.rx_access_log (
  id bigint generated always as identity primary key,
  path text not null, reader uuid, role text, ok boolean not null, at timestamptz not null default now());
alter table public.rx_access_log enable row level security;
revoke all on public.rx_access_log from anon, authenticated;
create or replace function public.rx_authorize_read(p_name text) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean; v_role text;
begin
  if (select auth.uid()) is null or p_name is null or p_name !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then return false; end if;
  v_ok := public.rx_path_readable(p_name);
  v_role := case when public.is_staff() then 'staff' when public.is_pharmacy() then 'pharmacy' else 'user' end;
  insert into public.rx_access_log(path,reader,role,ok) values (p_name,(select auth.uid()),v_role,coalesce(v_ok,false));
  return coalesce(v_ok,false);
end $$;
revoke all on function public.rx_authorize_read(text) from public, anon;
grant execute on function public.rx_authorize_read(text) to authenticated;
create or replace function public.rx_retention_candidates() returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o join public.prescription_requests r on r.id::text=split_part(o.name,'/',1)
  where o.bucket_id='prescriptions' and r.expires_at < now() - interval '7 days' $$;
revoke all on function public.rx_retention_candidates() from public, anon, authenticated;
grant execute on function public.rx_retention_candidates() to service_role;
grant insert on public.rx_access_log to service_role;
select count(*)::text||'x' as c from pg_proc where proname in ('rx_authorize_read','rx_retention_candidates');
