-- wasla-test ONLY. Draft, not a production migration. Requires 20261125002000 and later notification drafts.
-- Batch 1 item 5: a notification now says what changed (the new status) and the same event is not repeated.
-- info holds only a short status code (new, confirmed, in_progress, done, cancelled, assigned, picked_up, delivered, ...). No names, notes or addresses.
alter table public.notifications add column if not exists info text check (info is null or char_length(info) <= 40);
create or replace function public.notify_order_change() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if new.customer_id is null then return new; end if;
  if new.status is distinct from old.status then
    insert into public.notifications(user_id, kind, ref_id, info)
    select new.customer_id, 'order_status', new.id, new.status::text
    where not exists (select 1 from public.notifications n where n.user_id = new.customer_id and n.kind = 'order_status' and n.ref_id = new.id and n.info = new.status::text and n.read_at is null);
  end if;
  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.notifications(user_id, kind, ref_id)
    select new.customer_id, 'order_scheduled', new.id
    where not exists (select 1 from public.notifications n where n.user_id = new.customer_id and n.kind = 'order_scheduled' and n.ref_id = new.id and n.read_at is null);
  end if;
  return new;
end $$;
create or replace function public.notify_delivery_status() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(user_id, kind, ref_id, info)
    select new.customer_id, 'delivery_status', new.id, new.status::text
    where not exists (select 1 from public.notifications n where n.user_id = new.customer_id and n.kind = 'delivery_status' and n.ref_id = new.id and n.info = new.status::text and n.read_at is null);
  end if;
  return new;
end $$;
-- Mark exact duplicates that already exist as read (same user, kind, ref and info), keeping the newest. Notifications only.
update public.notifications n set read_at = now()
where n.read_at is null and exists (select 1 from public.notifications m where m.user_id = n.user_id and m.kind = n.kind and m.ref_id = n.ref_id and m.read_at is null and m.created_at > n.created_at and m.kind in ('order_status','delivery_status','order_scheduled'));
