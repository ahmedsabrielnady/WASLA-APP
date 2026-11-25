-- wasla-test ONLY draft (not a production migration). More notification sources, same generic rows as draft 2000:
-- a kind and a reference id, nothing else. No pharmacy name, price, note, address or health detail is ever stored in a notification.
-- Requires 2000 (notifications), 0100 (delivery_requests), 0500 (prescription_quotes), 0200 (tutor_sessions) and 2200 (session_join_links).
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'order_status','order_scheduled','change_request_applied','change_request_declined',
  'delivery_status','prescription_quote','session_cancelled','session_link'));

create or replace function public.notify_delivery_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(user_id, kind, ref_id) values (new.customer_id, 'delivery_status', new.id);
  end if;
  return new;
end $$;
revoke all on function public.notify_delivery_status() from public, anon, authenticated;
drop trigger if exists delivery_requests_notify on public.delivery_requests;
create trigger delivery_requests_notify after update of status on public.delivery_requests for each row execute function public.notify_delivery_status();

create or replace function public.notify_prescription_quote() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_customer uuid;
begin
  select customer_id into v_customer from public.prescription_requests where id = new.request_id;
  if v_customer is not null then
    insert into public.notifications(user_id, kind, ref_id) values (v_customer, 'prescription_quote', new.request_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_prescription_quote() from public, anon, authenticated;
drop trigger if exists prescription_quotes_notify on public.prescription_quotes;
create trigger prescription_quotes_notify after insert on public.prescription_quotes for each row execute function public.notify_prescription_quote();

create or replace function public.notify_session_cancelled() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.status = 'open' and new.status = 'cancelled' then
    insert into public.notifications(user_id, kind, ref_id)
    select e.student_id, 'session_cancelled', new.id from public.session_enrollments e where e.session_id = new.id and e.status = 'booked';
  end if;
  return new;
end $$;
revoke all on function public.notify_session_cancelled() from public, anon, authenticated;
drop trigger if exists tutor_sessions_notify on public.tutor_sessions;
create trigger tutor_sessions_notify after update of status on public.tutor_sessions for each row execute function public.notify_session_cancelled();

create or replace function public.notify_session_link() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.url is distinct from old.url then
    insert into public.notifications(user_id, kind, ref_id)
    select e.student_id, 'session_link', new.session_id from public.session_enrollments e where e.session_id = new.session_id and e.status = 'booked';
  end if;
  return new;
end $$;
revoke all on function public.notify_session_link() from public, anon, authenticated;
drop trigger if exists session_join_links_notify on public.session_join_links;
create trigger session_join_links_notify after insert or update of url on public.session_join_links for each row execute function public.notify_session_link();
