-- Applied to Supabase project wasla as migration:
-- staff_order_status_v2_rpc
--
-- Staff-only replacement for the revoked generic set_order_status RPC.
-- Enforces the private transition matrix and records every state change.

create or replace function public.staff_set_order_status_v2(
  p_order uuid,
  p_to text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then
    raise exception 'يلزم تسجيل الدخول' using errcode = '42501';
  end if;
  if not coalesce(public.is_staff(), false) then
    raise exception 'هذه العملية لفريق التشغيل فقط' using errcode = '42501';
  end if;
  if p_order is null or p_to is null then
    raise exception 'بيانات تحديث الطلب غير مكتملة' using errcode = '22023';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'الملاحظة أطول من المسموح' using errcode = '22023';
  end if;

  select * into v_order
    from public.orders
   where id = p_order
   for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.order_status_transitions t
     where t.from_status = v_order.status
       and t.to_status = p_to
       and t.actor_scope = 'staff'
  ) then
    raise exception 'انتقال الحالة غير مسموح من % إلى %', v_order.status, p_to
      using errcode = '42501';
  end if;

  if p_to in ('in_progress', 'done') and not exists (
    select 1
      from public.providers p
     where p.id = v_order.provider_id
       and p.approved = true
       and p.active = true
       and p.is_test = false
  ) then
    raise exception 'لا يمكن بدء التنفيذ أو إنهاؤه دون مقدم خدمة معتمد ونشط' using errcode = '42501';
  end if;

  update public.orders
     set status = p_to, updated_at = pg_catalog.now()
   where id = p_order;

  insert into public.order_events(order_id, actor_id, from_status, to_status, note)
  values (p_order, v_uid, v_order.status, p_to, v_note);
end;
$function$;

revoke all on function public.staff_set_order_status_v2(uuid, text, text) from public, anon;
grant execute on function public.staff_set_order_status_v2(uuid, text, text) to authenticated, service_role;

comment on function public.staff_set_order_status_v2(uuid, text, text) is
  'Staff-only order status update. Enforces the private transition matrix, approved provider assignment for execution, row locking, and an immutable event record.';
