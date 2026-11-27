-- wasla-test ONLY. Draft, not a production migration. Delivery for cart orders, courier and staff notifications, service-area list, doctor weekly schedule.
-- Requires: 20261125000100 (delivery_requests), the delivery-promo draft, 20261125002000 (notifications), 20261126000400 (store orders), and the delivery notification trigger.
-- Dispatch is manual by staff on purpose (courier dispatch to cart orders was missing). No payment is collected anywhere here.

-- 1. columns
alter table public.delivery_requests add column if not exists order_id uuid references public.orders(id);
alter table public.delivery_requests add column if not exists area text;
create unique index if not exists delivery_requests_one_live_per_order on public.delivery_requests(order_id) where order_id is not null and status <> 'cancelled';

-- 2. service area list. Empty list = no restriction (documented, the founder must fill it before launch).
create table if not exists public.delivery_areas (name text primary key check (char_length(name) between 2 and 60), active boolean not null default true);
alter table public.delivery_areas enable row level security;
revoke all on public.delivery_areas from public, anon, authenticated;

create or replace function public.delivery_areas_public() returns table(out_name text)
language sql stable security definer set search_path = '' as $$ select name from public.delivery_areas where active order by name; $$;
revoke all on function public.delivery_areas_public() from public;
grant execute on function public.delivery_areas_public() to anon, authenticated;

create or replace function public.admin_set_delivery_areas(p_names text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n text;
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode='42501'; end if;
 if coalesce(array_length(p_names,1),0) > 40 then raise exception 'عدد المناطق كبير' using errcode='22023'; end if;
 delete from public.delivery_areas;
 foreach n in array coalesce(p_names,'{}') loop
  n := trim(n);
  if char_length(n) between 2 and 60 then insert into public.delivery_areas(name) values (n) on conflict do nothing; end if;
 end loop;
end $$;
revoke all on function public.admin_set_delivery_areas(text[]) from public, anon;
grant execute on function public.admin_set_delivery_areas(text[]) to authenticated;

create or replace function public._delivery_area_ok(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
 select not exists (select 1 from public.delivery_areas where active) or exists (select 1 from public.delivery_areas where active and name = trim(coalesce(p_area,'')));
$$;
revoke all on function public._delivery_area_ok(text) from public, anon, authenticated;

-- 3. one fee decision used by both entry points (takes the config row lock)
create or replace function public._delivery_decision(p_customer uuid, p_dropoff text)
returns table(out_free boolean, out_list_fee int, out_pay int)
language plpgsql security definer set search_path = '' as $$
declare v_cfg public.delivery_promo%rowtype; v_n int; v_spent int; v_cust int; v_addr int; v_free boolean := false;
begin
 select * into v_cfg from public.delivery_promo where id = 1 for update;
 if v_cfg.enabled and v_cfg.courier_pay_egp is not null and v_cfg.max_free_deliveries > 0 and v_cfg.budget_cap_egp > 0
 and (v_cfg.starts_at is null or now() >= v_cfg.starts_at) and (v_cfg.ends_at is null or now() < v_cfg.ends_at) then
  select count(*), coalesce(sum(courier_pay_egp),0) into v_n, v_spent from public.delivery_requests where promo_applied and status <> 'cancelled';
  select count(*) into v_cust from public.delivery_requests where promo_applied and status <> 'cancelled' and customer_id = p_customer;
  select count(*) into v_addr from public.delivery_requests where promo_applied and status <> 'cancelled' and lower(regexp_replace(dropoff_address,'\s+',' ','g')) = lower(regexp_replace(trim(p_dropoff),'\s+',' ','g'));
  if v_n < v_cfg.max_free_deliveries and v_spent + v_cfg.courier_pay_egp <= v_cfg.budget_cap_egp and v_cust < v_cfg.per_customer_limit and v_addr < v_cfg.per_customer_limit then v_free := true; end if;
 end if;
 return query select v_free, v_cfg.list_fee_egp, case when v_free then v_cfg.courier_pay_egp else null end;
end $$;
revoke all on function public._delivery_decision(uuid,text) from public, anon, authenticated;

-- 4. customer errand request (replaces the 3-argument version, adds the area)
drop function if exists public.place_delivery_request(text,text,text);
create or replace function public.place_delivery_request(p_pickup text, p_dropoff text, p_what text, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int; d record;
begin
 if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
 if (select role from public.profiles where id = v_uid) is distinct from 'customer' then raise exception 'الطلب متاح لحسابات العملاء فقط' using errcode='42501'; end if;
 if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
  raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
 if not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if;
 select count(*) into v_open from public.delivery_requests where customer_id = v_uid and status in ('new','assigned','picked_up');
 if v_open >= 3 then raise exception 'عندك طلبات توصيل مفتوحة كتير، استنى لما تخلص' using errcode='53400'; end if;
 select count(*) into v_recent from public.delivery_requests where customer_id = v_uid and created_at > now() - interval '1 hour';
 if v_recent >= 6 then raise exception 'طلبات كتير في وقت قصير، استنى شوية' using errcode='53400'; end if;
 select * into d from public._delivery_decision(v_uid, p_dropoff);
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (v_uid, trim(p_pickup), trim(p_dropoff), trim(p_what), nullif(trim(coalesce(p_area,'')),''), d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.place_delivery_request(text,text,text,text) from public, anon;
grant execute on function public.place_delivery_request(text,text,text,text) to authenticated;

-- 5. staff dispatch of a cart order to a courier queue
create or replace function public.staff_dispatch_order(p_order uuid, p_area text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; v_name text; v_id uuid; d record;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select * into o from public.orders where id = p_order for update;
 if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;
 if o.product_id is null or o.sector <> 'store' then raise exception 'التوصيل متاح لطلبات المتجر فقط' using errcode='22023'; end if;
 if o.status not in ('confirmed','in_progress') then raise exception 'الطلب لازم يكون مؤكد من التاجر أولًا' using errcode='22023'; end if;
 if not public._delivery_area_ok(p_area) then raise exception 'التوصيل غير متاح في هذه المنطقة حاليًا' using errcode='22023'; end if;
 if exists (select 1 from public.delivery_requests where order_id = p_order and status <> 'cancelled') then raise exception 'تم تحويل الطلب لمندوب بالفعل' using errcode='22023'; end if;
 select coalesce(display_name,'التاجر') into v_name from public.providers where id = o.provider_id;
 select * into d from public._delivery_decision(o.customer_id, o.address);
 insert into public.delivery_requests(customer_id,pickup_address,dropoff_address,what_to_deliver,order_id,area,list_fee_egp,promo_applied,customer_fee_egp,courier_pay_egp)
 values (o.customer_id, 'من '||coalesce(v_name,'التاجر'), o.address, 'طلب '||o.ref, o.id, nullif(trim(coalesce(p_area,'')),''), d.out_list_fee, d.out_free, case when d.out_free then 0 else d.out_list_fee end, d.out_pay) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.staff_dispatch_order(uuid,text) from public, anon;
grant execute on function public.staff_dispatch_order(uuid,text) to authenticated;

-- 6. notifications: staff on a new request, the courier on assignment
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order_status','order_scheduled','change_request_applied','change_request_declined','delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised','doctor_note','course_changed','lab_status','lab_result_ready','delivery_new','delivery_assigned'));
create or replace function public.notify_delivery_dispatch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
  insert into public.notifications(user_id, kind, ref_id) select id, 'delivery_new', new.id from public.profiles where role = 'admin';
 elsif new.courier_id is not null and new.courier_id is distinct from old.courier_id then
  insert into public.notifications(user_id, kind, ref_id) select user_id, 'delivery_assigned', new.id from public.providers where id = new.courier_id and user_id is not null;
 end if;
 return null;
end $$;
revoke all on function public.notify_delivery_dispatch() from public, anon, authenticated;
drop trigger if exists delivery_requests_dispatch_notify on public.delivery_requests;
create trigger delivery_requests_dispatch_notify after insert or update of courier_id on public.delivery_requests for each row execute function public.notify_delivery_dispatch();

-- 7. doctor weekly schedule (own approved doctor; one range per weekday)
create or replace function public.doctor_set_schedule(p_weekday int, p_start time, p_end time, p_slot int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p uuid;
begin
 select id into v_p from public.providers where user_id = (select auth.uid()) and kind = 'doctor' and approved and active;
 if v_p is null then raise exception 'حساب طبيب معتمد فقط' using errcode='42501'; end if;
 if p_weekday is null or p_weekday not between 0 and 6 or p_start is null or p_end is null or p_end <= p_start or p_slot is null or p_slot not between 10 and 120 then raise exception 'بيانات الجدول غير صالحة' using errcode='22023'; end if;
 delete from public.provider_schedules where provider_id = v_p and weekday = p_weekday;
 insert into public.provider_schedules(provider_id, weekday, start_time, end_time, slot_minutes, active) values (v_p, p_weekday, p_start, p_end, p_slot, true);
end $$;
create or replace function public.doctor_clear_schedule_day(p_weekday int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p uuid;
begin
 select id into v_p from public.providers where user_id = (select auth.uid()) and kind = 'doctor' and approved and active;
 if v_p is null then raise exception 'حساب طبيب معتمد فقط' using errcode='42501'; end if;
 delete from public.provider_schedules where provider_id = v_p and weekday = p_weekday;
end $$;
revoke all on function public.doctor_set_schedule(int,time,time,int), public.doctor_clear_schedule_day(int) from public, anon;
grant execute on function public.doctor_set_schedule(int,time,time,int), public.doctor_clear_schedule_day(int) to authenticated;
