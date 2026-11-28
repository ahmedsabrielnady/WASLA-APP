-- wasla-test ONLY. Draft: Telegram link and alert sender plumbing. Not a production migration.
create extension if not exists pg_net with schema extensions;
create table if not exists public.provider_telegram (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint unique,
  link_code text unique,
  link_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.provider_telegram enable row level security;
revoke all on public.provider_telegram from anon, authenticated;

create or replace function public.provider_telegram_link_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not exists (select 1 from public.providers p where p.user_id = auth.uid() and p.approved and p.active) then
    raise exception 'الحساب غير معتمد كمقدم خدمة' using errcode = '42501'; end if;
  v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.provider_telegram(user_id, link_code, link_expires_at) values (auth.uid(), v_code, now() + interval '15 minutes')
  on conflict (user_id) do update set link_code = excluded.link_code, link_expires_at = excluded.link_expires_at;
  return v_code;
end $$;
revoke all on function public.provider_telegram_link_code() from public, anon;
grant execute on function public.provider_telegram_link_code() to authenticated;

create or replace function public.provider_telegram_status() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select chat_id is not null from public.provider_telegram where user_id = auth.uid()), false) $$;
revoke all on function public.provider_telegram_status() from public, anon;
grant execute on function public.provider_telegram_status() to authenticated;

create or replace function public.provider_telegram_unlink() returns void
language sql security definer set search_path = '' as $$
  update public.provider_telegram set chat_id = null, link_code = null, link_expires_at = null, linked_at = null where user_id = auth.uid() $$;
revoke all on function public.provider_telegram_unlink() from public, anon;
grant execute on function public.provider_telegram_unlink() to authenticated;

-- Used by the bot webhook (service role only): links a Telegram chat to the provider that typed the code.
create or replace function public.telegram_link_chat(p_code text, p_chat bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.provider_telegram set chat_id = p_chat, linked_at = now(), link_code = null, link_expires_at = null
   where link_code = pg_catalog.upper(pg_catalog.btrim(coalesce(p_code,''))) and link_expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.telegram_link_chat(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_link_chat(text, bigint) to service_role;

-- Shared secret between the database and the Edge Function. Generated here, never printed or typed by a person.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'wasla_tg_hook') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'wasla_tg_hook', 'Telegram alert hook secret (TEST)');
  end if;
end $$;
create or replace function public.telegram_hook_secret() returns text
language sql stable security definer set search_path = '' as $$ select decrypted_secret from vault.decrypted_secrets where name = 'wasla_tg_hook' limit 1 $$;
revoke all on function public.telegram_hook_secret() from public, anon, authenticated;
grant execute on function public.telegram_hook_secret() to service_role;

-- Returns the chat for one alert (service role only). Only the kind and the order id travel; no customer data.
create or replace function public.telegram_chat_for_alert(p_notification uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select t.chat_id from public.notifications n join public.provider_telegram t on t.user_id = n.user_id
   where n.id = p_notification and n.kind = 'provider_new_order' and t.chat_id is not null $$;
revoke all on function public.telegram_chat_for_alert(uuid) from public, anon, authenticated;
grant execute on function public.telegram_chat_for_alert(uuid) to service_role;

-- Fires the Edge Function after a provider_new_order notification row exists and the provider linked Telegram.
-- The function URL is stored in vault as 'wasla_tg_fn_url' by whoever deploys the function (no URL = no call).
create or replace function public.notify_telegram_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if new.kind <> 'provider_new_order' then return null; end if;
  if not exists (select 1 from public.provider_telegram where user_id = new.user_id and chat_id is not null) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'wasla_tg_fn_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'wasla_tg_hook' limit 1;
  if v_url is null or v_secret is null then return null; end if;
  perform net.http_post(url := v_url, body := jsonb_build_object('notification_id', new.id), headers := jsonb_build_object('content-type', 'application/json', 'x-wasla-hook', v_secret));
  return null;
exception when others then
  return null; -- an alert failure must never block order assignment
end $$;
revoke all on function public.notify_telegram_alert() from public, anon, authenticated;
drop trigger if exists notifications_telegram_alert on public.notifications;
create trigger notifications_telegram_alert after insert on public.notifications for each row execute function public.notify_telegram_alert();
