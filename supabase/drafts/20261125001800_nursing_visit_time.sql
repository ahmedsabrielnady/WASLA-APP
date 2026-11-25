-- wasla-test ONLY. Draft: nursing visit time. Customer proposes a preferred time on own nursing order (status new), staff set scheduled_at.
alter table public.orders add column if not exists preferred_at timestamptz;
create or replace function public.set_nursing_preferred_time(p_order uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode='28000'; end if;
  select * into v from public.orders where id=p_order and customer_id=auth.uid() and sector='nursing' for update;
  if not found then raise exception 'الطلب مش متاح' using errcode='42501'; end if;
  if v.status::text <> 'new' then raise exception 'مينفعش تغيير الميعاد بعد تأكيد الطلب' using errcode='42501'; end if;
  if p_at is null or p_at < now() + interval '1 hour' or p_at > now() + interval '60 days' then raise exception 'الميعاد غير صالح' using errcode='22023'; end if;
  update public.orders set preferred_at=p_at where id=p_order;
end $$;
create or replace function public.staff_schedule_order(p_order uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط' using errcode='42501'; end if;
  if p_at is null or p_at < now() or p_at > now() + interval '60 days' then raise exception 'الميعاد غير صالح' using errcode='22023'; end if;
  update public.orders set scheduled_at=p_at where id=p_order and sector='nursing' and status::text in ('new','confirmed');
  if not found then raise exception 'الطلب مش متاح للجدولة' using errcode='22023'; end if;
  insert into public.order_events(order_id,actor_id,from_status,to_status,note) select id,auth.uid(),status,status,'تم تحديد الميعاد' from public.orders where id=p_order;
end $$;
revoke all on function public.set_nursing_preferred_time(uuid,timestamptz), public.staff_schedule_order(uuid,timestamptz) from public, anon;
grant execute on function public.set_nursing_preferred_time(uuid,timestamptz), public.staff_schedule_order(uuid,timestamptz) to authenticated;
