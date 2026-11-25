-- wasla-test ONLY draft (not a production migration). Opt-in storage for Web Push subscriptions. Nothing here sends a push.
-- A sender (edge function with VAPID keys) does not exist and is NOT part of this draft. Only the service role could read these rows.
-- Notification text carries no health detail: the service worker shows one fixed generic line and ignores any payload text.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 600),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;  -- no direct access for any app role; no policies on purpose

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if v_uid is null then raise exception 'auth required' using errcode='28000'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 600 then raise exception 'invalid endpoint' using errcode='22023'; end if;
  if p_p256dh is null or char_length(p_p256dh) not between 20 and 200 or p_auth is null or char_length(p_auth) not between 8 and 100 then raise exception 'invalid keys' using errcode='22023'; end if;
  -- a browser endpoint belongs to one user at a time: re-subscribing moves it to the caller
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid;
  if not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint) then
    select count(*) into v_n from public.push_subscriptions where user_id = v_uid;
    if v_n >= 5 then raise exception 'too many devices' using errcode='54000'; end if;
    insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth);
  else
    update public.push_subscriptions set p256dh = p_p256dh, auth = p_auth where endpoint = p_endpoint and user_id = v_uid;
  end if;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if v_uid is null then raise exception 'auth required' using errcode='28000'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.push_my_device_count() returns int
language sql security definer set search_path = '' stable as $$
  select case when (select auth.uid()) is null then 0 else (select count(*)::int from public.push_subscriptions where user_id = (select auth.uid())) end
$$;

revoke all on function public.push_subscribe(text,text,text), public.push_unsubscribe(text), public.push_my_device_count() from public, anon;
grant execute on function public.push_subscribe(text,text,text), public.push_unsubscribe(text), public.push_my_device_count() to authenticated;
