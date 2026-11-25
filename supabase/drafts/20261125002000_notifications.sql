-- wasla-test ONLY. Draft: in-app notifications (free, no third party). One row per event for the order's customer.
-- Rows carry only a kind and the order id: no service name, no note, no health detail. The app maps kind to generic text.
-- Written only by triggers (security definer). Customers read their own rows; no direct writes.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('order_status','order_scheduled','change_request_applied','change_request_declined')),
  ref_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_created on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.notify_order_change() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.customer_id is null then return new; end if;
  if new.status is distinct from old.status then
    insert into public.notifications(user_id, kind, ref_id) values (new.customer_id, 'order_status', new.id);
  end if;
  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.notifications(user_id, kind, ref_id) values (new.customer_id, 'order_scheduled', new.id);
  end if;
  return new;
end $$;
revoke all on function public.notify_order_change() from public, anon, authenticated;
drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after update of status, scheduled_at on public.orders for each row execute function public.notify_order_change();

create or replace function public.notify_change_request_resolved() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  -- 'applied' needs no row of its own: it is only accepted after the order really changed, and that change already notified the customer
  -- (order_status or order_scheduled). Only a decline is new information.
  if old.status = 'open' and new.status = 'declined' then
    insert into public.notifications(user_id, kind, ref_id) values (new.customer_id, 'change_request_declined', new.order_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_change_request_resolved() from public, anon, authenticated;
drop trigger if exists ocr_notify on public.order_change_requests;
create trigger ocr_notify after update of status on public.order_change_requests for each row execute function public.notify_change_request_resolved();

create or replace function public.mark_notifications_read() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
