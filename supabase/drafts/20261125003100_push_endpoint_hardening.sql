-- wasla-test ONLY draft (not a production migration). Hardens draft 3000 before any sender exists. Nothing here sends a push.
-- 1) Endpoint origin allowlist, fail-closed. Origins confirmed against vendor docs on 2026-11-25:
--    fcm.googleapis.com (Chrome, https://developer.chrome.com/blog/web-push-interop-wins), updates.push.services.mozilla.com (Firefox, https://mozilla-services.github.io/autopush-rs/http.html),
--    one-label-under .push.apple.com (Safari, https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
--    notify.windows.com (Edge) is NOT allowed: no vendor doc was verified. Edge users cannot enable push until it is verified.
--    Host must be lowercase, no port, no userinfo, no query or fragment, no dot-dot or encoded slash/dot/at in the path. The sender must repeat this check at send time and never follow redirects.
-- 2) An endpoint owned by another user is never taken over: subscribe fails with 42501. Move happens only after the owner unsubscribes.
delete from public.push_subscriptions where endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com)/[A-Za-z0-9._~:@!$&()*+,;=%/-]*$';
alter table public.push_subscriptions drop constraint if exists push_endpoint_origin;
alter table public.push_subscriptions add constraint push_endpoint_origin check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com)/[A-Za-z0-9._~:@!$&()*+,;=%/-]*$'
  and endpoint !~* '(/\.\.?(/|$)|%2e|%2f|%5c|%40)');

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_n int; v_owner uuid;
begin
  if v_uid is null then raise exception 'auth required' using errcode='28000'; end if;
  if p_endpoint is null or char_length(p_endpoint) > 600
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com)/[A-Za-z0-9._~:@!$&()*+,;=%/-]*$'
     or p_endpoint ~* '(/\.\.?(/|$)|%2e|%2f|%5c|%40)' then raise exception 'invalid endpoint' using errcode='22023'; end if;
  if p_p256dh is null or char_length(p_p256dh) not between 20 and 200 or p_auth is null or char_length(p_auth) not between 8 and 100 then raise exception 'invalid keys' using errcode='22023'; end if;
  select user_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
  if v_owner is not null and v_owner <> v_uid then raise exception 'endpoint belongs to another user' using errcode='42501'; end if;
  if v_owner is null then
    select count(*) into v_n from public.push_subscriptions where user_id = v_uid;
    if v_n >= 5 then raise exception 'too many devices' using errcode='54000'; end if;
    insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth);
  else
    update public.push_subscriptions set p256dh = p_p256dh, auth = p_auth where endpoint = p_endpoint and user_id = v_uid;
  end if;
end $$;
revoke all on function public.push_subscribe(text,text,text) from public, anon;
grant execute on function public.push_subscribe(text,text,text) to authenticated;

select 'ok:' || (select count(*) from pg_constraint where conname='push_endpoint_origin')::text || ':' || (select count(*) from public.push_subscriptions)::text as v;
