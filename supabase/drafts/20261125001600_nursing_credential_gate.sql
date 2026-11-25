-- wasla-test ONLY. Draft: nursing provider credential gate, NOT a production migration. Requires draft 1500.
-- A generic technician or doctor role plus service coverage is not a nursing credential. This adds an explicit,
-- staff-set flag. Who counts as qualified (license type, number, expiry, document review) is an owner and legal decision;
-- this draft only enforces that someone with that authority marked the provider, and records who and when.
-- 1. providers.nursing_credential_verified (default false), _at, _by. Only staff may change it (trigger); the SQL editor
--    and service role may too.
-- 2. staff_set_nursing_credential(provider, verified) RPC for staff, doctor and technician providers only.
-- 3. A trigger on orders: a nursing order can only get a provider_id whose flag is true, whatever RPC sets it.
-- 4. request_nursing_visit counts only credentialed covering providers.
alter table public.providers add column if not exists nursing_credential_verified boolean not null default false;
alter table public.providers add column if not exists nursing_credential_verified_at timestamptz;
alter table public.providers add column if not exists nursing_credential_verified_by uuid;

create or replace function public.guard_nursing_credential_flag() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.nursing_credential_verified is distinct from old.nursing_credential_verified
     and current_user in ('authenticated','anon') and not coalesce(public.is_staff(), false) then
    raise exception 'غير مصرح بتغيير اعتماد التمريض' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists providers_guard_nursing_credential on public.providers;
create trigger providers_guard_nursing_credential before update on public.providers for each row execute function public.guard_nursing_credential_flag();

create or replace function public.staff_set_nursing_credential(p_provider uuid, p_verified boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'مسموح للسكرتارية بس' using errcode = '42501'; end if;
  if not exists (select 1 from public.providers where id = p_provider and kind in ('doctor','technician')) then raise exception 'نوع مقدم الخدمة غير مناسب' using errcode = '22023'; end if;
  update public.providers set nursing_credential_verified = coalesce(p_verified, false),
    nursing_credential_verified_at = case when p_verified then now() else null end,
    nursing_credential_verified_by = case when p_verified then auth.uid() else null end where id = p_provider;
end $$;
revoke all on function public.staff_set_nursing_credential(uuid, boolean) from public, anon;
grant execute on function public.staff_set_nursing_credential(uuid, boolean) to authenticated;

create or replace function public.guard_nursing_order_provider() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.sector = 'nursing' and new.provider_id is not null and (tg_op = 'INSERT' or new.provider_id is distinct from old.provider_id)
     and not exists (select 1 from public.providers p where p.id = new.provider_id and p.nursing_credential_verified and p.approved and p.active and not p.is_test) then
    raise exception 'مقدم الخدمة غير معتمد للتمريض' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists orders_guard_nursing_provider on public.orders;
create trigger orders_guard_nursing_provider before insert or update of provider_id on public.orders for each row execute function public.guard_nursing_order_provider();

create or replace function public.request_nursing_visit(p_item integer, p_address text, p_notes text default null, p_idempotency_key text default null)
returns table(out_order_id uuid, out_ref text, out_price integer)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_item public.service_items%rowtype; v_order public.orders%rowtype; v_recent int;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if p_address is null or char_length(trim(p_address)) < 4 or char_length(trim(p_address)) > 255 then raise exception 'العنوان غير صالح' using errcode = '22023'; end if;
  if p_notes is not null and char_length(p_notes) > 500 then raise exception 'الملاحظات أطول من المسموح' using errcode = '22023'; end if;
  if p_idempotency_key is not null and (char_length(trim(p_idempotency_key)) < 8 or char_length(trim(p_idempotency_key)) > 128) then raise exception 'مفتاح منع التكرار غير صالح' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  if p_idempotency_key is not null then
    select * into v_order from public.orders where customer_id = v_uid and idempotency_key = trim(p_idempotency_key);
    if found then return query select v_order.id, v_order.ref, v_order.price_egp; return; end if;
  end if;
  if not (exists (select 1 from public.consents where user_id = v_uid and kind = 'terms')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'privacy')
      and exists (select 1 from public.consents where user_id = v_uid and kind = 'health_data')) then
    raise exception 'لازم توافق على الشروط والخصوصية والبيانات الصحية الأول' using errcode = '42501'; end if;
  select count(*) into v_recent from public.orders where customer_id = v_uid and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode = '53400'; end if;
  select * into v_item from public.service_items where id = p_item and sector = 'nursing' and active = true and nursing_intake_open = true for share;
  if not found or not exists (select 1 from public.provider_service_coverage c join public.providers pr on pr.id = c.provider_id where c.service_item_id = p_item and c.active and pr.approved and pr.active and not pr.is_test and pr.nursing_credential_verified) then raise exception 'الخدمة دي مش متاحة للطلب حاليًا' using errcode = '22023'; end if;
  insert into public.orders (customer_id, sector, item_id, address, notes, price_egp, deposit_egp, source, idempotency_key)
  values (v_uid, 'nursing', p_item, trim(p_address), nullif(trim(coalesce(p_notes, '')), ''), v_item.price_egp, 0, 'web', nullif(trim(coalesce(p_idempotency_key, '')), ''))
  returning * into v_order;
  insert into public.order_events (order_id, actor_id, from_status, to_status, note) values (v_order.id, v_uid, null, 'new', 'تم استلام طلب التمريض');
  return query select v_order.id, v_order.ref, v_order.price_egp;
end $function$;
revoke all on function public.request_nursing_visit(integer,text,text,text) from public, anon;
grant execute on function public.request_nursing_visit(integer,text,text,text) to authenticated;
