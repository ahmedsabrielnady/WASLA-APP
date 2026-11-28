-- wasla-test ONLY. Draft, not a production migration.
-- Batch 1 item 4: block, at database level, assigning an order to a provider of the wrong kind
-- (for example a clinic booking to a plumber). Same sector/kind map as assign_order_v2, now enforced for every path.
-- Only fires when provider_id is set or changed, so existing rows are untouched.
create or replace function public.guard_order_provider_kind() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_kind text; v_ok boolean;
begin
  if new.provider_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.provider_id is not distinct from old.provider_id then return new; end if;
  select kind into v_kind from public.providers where id = new.provider_id;
  if v_kind is null then return new; end if;
  v_ok := case new.sector
    when 'clinic' then v_kind = 'doctor'
    when 'nursing' then v_kind in ('doctor','technician','nurse')
    when 'maintenance' then v_kind = 'technician'
    when 'car' then v_kind = 'technician'
    when 'education' then v_kind = 'teacher'
    when 'delivery' then v_kind = 'courier'
    when 'food' then v_kind in ('merchant','courier')
    when 'market' then v_kind = 'merchant'
    when 'store' then v_kind = 'merchant'
    else true end;
  if not v_ok then
    raise exception 'نوع مقدم الخدمة غير مناسب لنوع الطلب' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.guard_order_provider_kind() from public, anon, authenticated;
drop trigger if exists orders_guard_provider_kind on public.orders;
create trigger orders_guard_provider_kind before insert or update of provider_id on public.orders
  for each row execute function public.guard_order_provider_kind();
