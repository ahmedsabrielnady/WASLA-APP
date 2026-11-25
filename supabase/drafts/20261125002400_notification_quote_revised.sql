-- wasla-test ONLY draft (not a production migration). Chosen behavior, labelled: the first answer from a pharmacy notifies the patient
-- ('prescription_quote', draft 2300). A MATERIAL revision of that answer notifies again ('prescription_quote_revised'): price, delivery
-- availability or delivery time changed. A note-only edit does not notify. Rows carry a kind and the request id only.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'order_status','order_scheduled','change_request_applied','change_request_declined',
  'delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised'));

create or replace function public.notify_prescription_quote_revised() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_customer uuid;
begin
  if new.price_egp is distinct from old.price_egp
     or new.delivery_available is distinct from old.delivery_available
     or new.eta_minutes is distinct from old.eta_minutes then
    select customer_id into v_customer from public.prescription_requests where id = new.request_id;
    if v_customer is not null then
      insert into public.notifications(user_id, kind, ref_id) values (v_customer, 'prescription_quote_revised', new.request_id);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.notify_prescription_quote_revised() from public, anon, authenticated;
drop trigger if exists prescription_quotes_revised_notify on public.prescription_quotes;
create trigger prescription_quotes_revised_notify after update on public.prescription_quotes for each row execute function public.notify_prescription_quote_revised();
