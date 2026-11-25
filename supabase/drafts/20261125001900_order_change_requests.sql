-- wasla-test ONLY. Draft: customer request to change the time of, or cancel, a nursing order AFTER confirmation.
-- It is a request, never an automatic change: staff review it and act with the existing tools (schedule or cancel).
-- No fees, no cancellation terms and no refunds are defined here. Those stay owner decisions.
create table if not exists public.order_change_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('change_time','cancel')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open','handled','dismissed')),
  created_at timestamptz not null default now(),
  handled_by uuid references auth.users(id),
  handled_at timestamptz
);
create unique index if not exists order_change_requests_one_open on public.order_change_requests(order_id, kind) where status = 'open';
alter table public.order_change_requests enable row level security;
revoke all on public.order_change_requests from public, anon, authenticated;
grant select on public.order_change_requests to authenticated;
drop policy if exists ocr_read on public.order_change_requests;
create policy ocr_read on public.order_change_requests for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());

create or replace function public.customer_request_order_change(p_order uuid, p_kind text, p_note text default null) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v public.orders%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode='28000'; end if;
  if p_kind not in ('change_time','cancel') then raise exception 'نوع الطلب غير صالح' using errcode='22023'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'الملاحظة أطول من المسموح' using errcode='22023'; end if;
  select * into v from public.orders where id=p_order and customer_id=auth.uid() and sector='nursing' for update;
  if not found then raise exception 'الطلب مش متاح' using errcode='42501'; end if;
  if v.status::text not in ('confirmed','in_progress') then raise exception 'الطلب لازم يكون مؤكد عشان تطلب تعديل أو إلغاء' using errcode='22023'; end if;
  insert into public.order_change_requests(order_id, customer_id, kind, note) values (p_order, auth.uid(), p_kind, nullif(trim(coalesce(p_note,'')),''))
    on conflict (order_id, kind) where status='open' do nothing returning id into v_id;
  if v_id is null then raise exception 'عندك طلب مفتوح بالفعل لنفس الطلب' using errcode='22023'; end if;
  insert into public.order_events(order_id, actor_id, from_status, to_status, note) values (p_order, auth.uid(), v.status, v.status, case p_kind when 'cancel' then 'طلب العميل إلغاء بعد التأكيد' else 'طلب العميل تغيير الموعد بعد التأكيد' end);
  return v_id;
end $$;

create or replace function public.staff_handle_order_change(p_request uuid, p_status text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط' using errcode='42501'; end if;
  if p_status not in ('handled','dismissed') then raise exception 'حالة غير صالحة' using errcode='22023'; end if;
  update public.order_change_requests set status=p_status, handled_by=auth.uid(), handled_at=now() where id=p_request and status='open';
  if not found then raise exception 'الطلب غير موجود أو تم التعامل معه' using errcode='22023'; end if;
end $$;
revoke all on function public.customer_request_order_change(uuid,text,text), public.staff_handle_order_change(uuid,text) from public, anon;
grant execute on function public.customer_request_order_change(uuid,text,text), public.staff_handle_order_change(uuid,text) to authenticated;
