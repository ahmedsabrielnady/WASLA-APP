-- wasla-test ONLY. Draft, not a production migration.
-- In-app "new order for you" alert for a provider. Fires when an order gets a provider (insert with provider_id, or provider_id set/changed).
-- The row carries only the kind and the order id. No service name, note or customer detail.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order_status','order_scheduled','change_request_applied','change_request_declined','delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised','doctor_note','course_changed','lab_status','lab_result_ready','delivery_new','delivery_assigned','provider_new_order'));

create or replace function public.notify_provider_new_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.provider_id is not distinct from old.provider_id then return null; end if;
  insert into public.notifications(user_id, kind, ref_id)
    select p.user_id, 'provider_new_order', new.id
      from public.providers p
     where p.id = new.provider_id and p.user_id is not null and p.approved and p.active and not p.is_test;
  return null;
end $$;
revoke all on function public.notify_provider_new_order() from public, anon, authenticated;
drop trigger if exists orders_provider_alert on public.orders;
create trigger orders_provider_alert after insert or update of provider_id on public.orders
  for each row execute function public.notify_provider_new_order();
