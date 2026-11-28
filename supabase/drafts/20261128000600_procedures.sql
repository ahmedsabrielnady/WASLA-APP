-- wasla-test ONLY. Draft, not a production migration. Requires notifications (20261125002000), providers, orders.
-- Doctor procedures and add-ons. No prices and no fees are seeded: every price and fee is set by the founder.
-- Platform fee is a flat amount per procedure type (not a percentage). Accrual only, nothing is collected.
-- Legal note: a fee on referrals may conflict with medical ethics rules. It is OFF by default (procedure_settings.fee_applies_to_referrals) until a lawyer confirms.
create table if not exists public.procedure_types (
  id serial primary key,
  name text not null unique check (char_length(name) between 2 and 80),
  category text not null check (category in ('exam','lab','imaging','procedure','surgery_referral','follow_up')),
  active boolean not null default true,
  platform_fee_egp integer check (platform_fee_egp is null or platform_fee_egp between 0 and 100000),
  created_at timestamptz not null default now()
);
create table if not exists public.procedure_settings (
  id smallint primary key default 1 check (id = 1),
  fee_applies_to_referrals boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.procedure_settings(id) values (1) on conflict (id) do nothing;
create table if not exists public.doctor_procedure_offers (
  doctor_id uuid not null references public.providers(id) on delete cascade,
  procedure_type_id integer not null references public.procedure_types(id) on delete cascade,
  offered boolean not null default true,
  price_egp integer check (price_egp is null or price_egp between 1 and 1000000),
  primary key (doctor_id, procedure_type_id)
);
create table if not exists public.consultation_procedures (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  doctor_id uuid not null references public.providers(id),
  patient_id uuid not null references public.profiles(id),
  procedure_type_id integer references public.procedure_types(id),
  referral_label text check (referral_label is null or char_length(referral_label) between 2 and 120),
  origin text not null check (origin in ('booking_addon','doctor_requested')),
  status text not null default 'requested' check (status in ('requested','confirmed','declined','performed','cancelled')),
  price_snapshot_egp integer check (price_snapshot_egp is null or price_snapshot_egp >= 0),
  fee_snapshot_egp integer check (fee_snapshot_egp is null or fee_snapshot_egp >= 0),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  performed_at timestamptz,
  check ((procedure_type_id is not null) or (referral_label is not null))
);
create index if not exists consultation_procedures_order_idx on public.consultation_procedures(order_id);
create index if not exists consultation_procedures_doctor_idx on public.consultation_procedures(doctor_id, created_at);
create index if not exists consultation_procedures_patient_idx on public.consultation_procedures(patient_id);
create index if not exists consultation_procedures_type_idx on public.consultation_procedures(procedure_type_id);
create table if not exists public.visit_outcomes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  doctor_id uuid not null references public.providers(id),
  none_performed boolean not null,
  recorded_at timestamptz not null default now(),
  patient_confirmed_at timestamptz
);
create index if not exists visit_outcomes_doctor_idx on public.visit_outcomes(doctor_id);
create table if not exists public.procedure_fee_ledger (
  id uuid primary key default gen_random_uuid(),
  consultation_procedure_id uuid not null unique references public.consultation_procedures(id) on delete restrict,
  doctor_id uuid not null references public.providers(id),
  fee_egp integer not null check (fee_egp >= 0),
  month date not null,
  created_at timestamptz not null default now()
);
create index if not exists procedure_fee_ledger_doctor_idx on public.procedure_fee_ledger(doctor_id, month);
alter table public.procedure_types enable row level security;
alter table public.procedure_settings enable row level security;
alter table public.doctor_procedure_offers enable row level security;
alter table public.consultation_procedures enable row level security;
alter table public.visit_outcomes enable row level security;
alter table public.procedure_fee_ledger enable row level security;
revoke all on public.procedure_types, public.procedure_settings, public.doctor_procedure_offers, public.consultation_procedures, public.visit_outcomes, public.procedure_fee_ledger from anon, authenticated;
grant select on public.procedure_types to authenticated;
drop policy if exists procedure_types_read on public.procedure_types;
create policy procedure_types_read on public.procedure_types for select to authenticated using (active or (select public.is_staff()));
drop policy if exists procedure_settings_staff on public.procedure_settings;
create policy procedure_settings_staff on public.procedure_settings for select to authenticated using ((select public.is_staff()));
grant select on public.procedure_settings to authenticated;
grant select on public.doctor_procedure_offers, public.consultation_procedures, public.visit_outcomes, public.procedure_fee_ledger to authenticated;
drop policy if exists dpo_read on public.doctor_procedure_offers;
create policy dpo_read on public.doctor_procedure_offers for select to authenticated using (doctor_id = (select public.current_provider_id()) or (select public.is_staff()));
drop policy if exists cp_read on public.consultation_procedures;
create policy cp_read on public.consultation_procedures for select to authenticated using (patient_id = (select auth.uid()) or doctor_id = (select public.current_provider_id()) or (select public.is_staff()));
drop policy if exists vo_read on public.visit_outcomes;
create policy vo_read on public.visit_outcomes for select to authenticated using (doctor_id = (select public.current_provider_id()) or (select public.is_staff()) or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));
drop policy if exists pfl_read on public.procedure_fee_ledger;
create policy pfl_read on public.procedure_fee_ledger for select to authenticated using (doctor_id = (select public.current_provider_id()) or (select public.is_staff()));

-- notification kinds
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order_status','order_scheduled','change_request_applied','change_request_declined','delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised','doctor_note','course_changed','lab_status','lab_result_ready','delivery_new','delivery_assigned','provider_new_order','procedure_requested','procedure_decided','visit_summary_ready'));

-- founder: types, fee, per-doctor price, referral setting
create or replace function public.staff_set_procedure_type(p_id integer, p_name text, p_category text, p_active boolean, p_fee integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_id integer;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.procedure_types(name, category, active, platform_fee_egp) values (btrim(p_name), p_category, coalesce(p_active, true), p_fee) returning id into v_id;
  else
    update public.procedure_types set name = btrim(p_name), category = p_category, active = coalesce(p_active, active), platform_fee_egp = p_fee where id = p_id returning id into v_id;
    if v_id is null then raise exception 'النوع غير موجود' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.staff_set_doctor_procedure_price(p_doctor uuid, p_type integer, p_price integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if not exists (select 1 from public.providers where id = p_doctor and kind = 'doctor') then raise exception 'مقدم الخدمة ليس طبيبًا' using errcode = '22023'; end if;
  insert into public.doctor_procedure_offers(doctor_id, procedure_type_id, offered, price_egp) values (p_doctor, p_type, false, p_price)
  on conflict (doctor_id, procedure_type_id) do update set price_egp = excluded.price_egp;
end $$;
create or replace function public.staff_set_procedure_referral_fee(p_applies boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  update public.procedure_settings set fee_applies_to_referrals = coalesce(p_applies, false), updated_at = now() where id = 1;
end $$;

-- doctor: choose which procedure types he offers
create or replace function public.doctor_set_offered_procedures(p_types integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := public.current_provider_id();
begin
  if auth.uid() is null or v_pid is null then raise exception 'سجل دخولك كطبيب' using errcode = '42501'; end if;
  if not exists (select 1 from public.providers where id = v_pid and kind = 'doctor') then raise exception 'الحساب ده مش طبيب' using errcode = '42501'; end if;
  update public.doctor_procedure_offers set offered = false where doctor_id = v_pid and not (procedure_type_id = any(coalesce(p_types, '{}')));
  insert into public.doctor_procedure_offers(doctor_id, procedure_type_id, offered)
  select v_pid, t.id, true from public.procedure_types t where t.active and t.id = any(coalesce(p_types, '{}'))
  on conflict (doctor_id, procedure_type_id) do update set offered = true;
end $$;

-- patient: what this doctor offers (only offered, active and priced)
create or replace function public.doctor_bookable_procedures(p_doctor uuid)
returns table(procedure_type_id integer, name text, category text, price_egp integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.category, o.price_egp from public.doctor_procedure_offers o join public.procedure_types t on t.id = o.procedure_type_id
  where o.doctor_id = p_doctor and o.offered and t.active and o.price_egp is not null and auth.uid() is not null order by t.name;
$$;

-- patient: add-ons chosen at booking
create or replace function public.customer_pick_booking_addons(p_order uuid, p_types integer[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.orders%rowtype; r record; n integer := 0;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.customer_id <> v_uid or v_o.sector <> 'clinic' or v_o.provider_id is null then raise exception 'الحجز غير متاح' using errcode = '42501'; end if;
  if v_o.status not in ('new','confirmed') then raise exception 'لا يمكن إضافة خدمات بعد بدء الكشف' using errcode = '22023'; end if;
  for r in select t.id, o.price_egp, t.platform_fee_egp from public.procedure_types t join public.doctor_procedure_offers o on o.procedure_type_id = t.id
           where o.doctor_id = v_o.provider_id and o.offered and t.active and o.price_egp is not null and t.id = any(coalesce(p_types, '{}')) loop
    if not exists (select 1 from public.consultation_procedures c where c.order_id = p_order and c.procedure_type_id = r.id and c.status not in ('declined','cancelled')) then
      insert into public.consultation_procedures(order_id, doctor_id, patient_id, procedure_type_id, origin, status, price_snapshot_egp, fee_snapshot_egp, decided_at)
      values (p_order, v_o.provider_id, v_uid, r.id, 'booking_addon', 'confirmed', r.price_egp, r.platform_fee_egp, now());
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- doctor: request a procedure (own offers) or record an external referral (no price, no fee)
create or replace function public.doctor_request_procedure(p_order uuid, p_type integer, p_label text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := public.current_provider_id(); v_o public.orders%rowtype; v_off record; v_id uuid; v_label text := nullif(btrim(coalesce(p_label,'')), '');
begin
  if auth.uid() is null or v_pid is null then raise exception 'سجل دخولك كطبيب' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.provider_id is distinct from v_pid or v_o.sector <> 'clinic' then raise exception 'الحجز ده مش تبعك' using errcode = '42501'; end if;
  if v_o.status not in ('confirmed','in_progress','done') then raise exception 'الكشف لسه ما بدأش' using errcode = '22023'; end if;
  if exists (select 1 from public.visit_outcomes where order_id = p_order and patient_confirmed_at is not null) then raise exception 'الزيارة اتقفلت بتأكيد المريض' using errcode = '22023'; end if;
  if p_type is not null then
    select o.price_egp, t.platform_fee_egp into v_off from public.doctor_procedure_offers o join public.procedure_types t on t.id = o.procedure_type_id
      where o.doctor_id = v_pid and o.procedure_type_id = p_type and o.offered and t.active;
    if not found then raise exception 'الإجراء ده مش ضمن اللي بتقدمه' using errcode = '22023'; end if;
    if v_off.price_egp is null then raise exception 'سعر الإجراء لسه مش محدد' using errcode = '22023'; end if;
    insert into public.consultation_procedures(order_id, doctor_id, patient_id, procedure_type_id, origin, status, price_snapshot_egp, fee_snapshot_egp, note)
    values (p_order, v_pid, v_o.customer_id, p_type, 'doctor_requested', 'requested', v_off.price_egp, v_off.platform_fee_egp, nullif(btrim(coalesce(p_note,'')), '')) returning id into v_id;
  else
    if v_label is null then raise exception 'اكتب اسم الإجراء أو الإحالة' using errcode = '22023'; end if;
    insert into public.consultation_procedures(order_id, doctor_id, patient_id, referral_label, origin, status, note)
    values (p_order, v_pid, v_o.customer_id, v_label, 'doctor_requested', 'requested', nullif(btrim(coalesce(p_note,'')), '')) returning id into v_id;
  end if;
  insert into public.notifications(user_id, kind, ref_id, info) values (v_o.customer_id, 'procedure_requested', v_id, 'requested');
  return v_id;
end $$;

-- patient: confirm or decline a requested procedure
create or replace function public.patient_decide_procedure(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c public.consultation_procedures%rowtype; v_user uuid;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  select * into c from public.consultation_procedures where id = p_id for update;
  if not found or c.patient_id <> v_uid then raise exception 'الطلب غير متاح' using errcode = '42501'; end if;
  if c.status <> 'requested' then raise exception 'الطلب اتحسم قبل كده' using errcode = '22023'; end if;
  update public.consultation_procedures set status = case when p_accept then 'confirmed' else 'declined' end, decided_at = now() where id = p_id;
  select user_id into v_user from public.providers where id = c.doctor_id;
  if v_user is not null then insert into public.notifications(user_id, kind, ref_id, info) values (v_user, 'procedure_decided', p_id, case when p_accept then 'confirmed' else 'declined' end); end if;
end $$;

-- doctor: record what was performed (or none). Every confirmed procedure must be performed or cancelled. Fee accrues here, flat, doctor's statement.
create or replace function public.doctor_record_visit_outcome(p_order uuid, p_performed uuid[], p_cancelled uuid[], p_none boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := public.current_provider_id(); v_o public.orders%rowtype; v_apply_ref boolean; r record; v_open integer;
begin
  if auth.uid() is null or v_pid is null then raise exception 'سجل دخولك كطبيب' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.provider_id is distinct from v_pid or v_o.sector <> 'clinic' then raise exception 'الحجز ده مش تبعك' using errcode = '42501'; end if;
  if v_o.status not in ('in_progress','done') then raise exception 'ابدأ الكشف الأول' using errcode = '22023'; end if;
  if exists (select 1 from public.visit_outcomes where order_id = p_order and patient_confirmed_at is not null) then raise exception 'المريض أكد الملخص بالفعل' using errcode = '22023'; end if;
  if coalesce(p_none, false) and coalesce(array_length(p_performed,1),0) > 0 then raise exception 'لا يمكن اختيار (لا شيء) مع إجراءات منفذة' using errcode = '22023'; end if;
  if not coalesce(p_none, false) and coalesce(array_length(p_performed,1),0) = 0 then raise exception 'سجل الإجراءات المنفذة أو اختر (لا شيء)' using errcode = '22023'; end if;
  update public.consultation_procedures set status = 'cancelled' where order_id = p_order and status = 'confirmed' and id = any(coalesce(p_cancelled,'{}')) and id <> all(coalesce(p_performed,'{}'));
  select count(*) into v_open from public.consultation_procedures c where c.order_id = p_order and c.status = 'confirmed' and c.id <> all(coalesce(p_performed,'{}'));
  if v_open > 0 then raise exception 'في إجراءات مؤكدة لازم تتسجل كمنفذة أو ملغية' using errcode = '22023'; end if;
  select fee_applies_to_referrals into v_apply_ref from public.procedure_settings where id = 1;
  for r in select * from public.consultation_procedures c where c.order_id = p_order and c.status = 'confirmed' and c.id = any(coalesce(p_performed,'{}')) loop
    update public.consultation_procedures set status = 'performed', performed_at = now() where id = r.id;
    if r.fee_snapshot_egp is not null and (r.procedure_type_id is not null or coalesce(v_apply_ref,false)) then
      insert into public.procedure_fee_ledger(consultation_procedure_id, doctor_id, fee_egp, month) values (r.id, v_pid, r.fee_snapshot_egp, date_trunc('month', now())::date) on conflict (consultation_procedure_id) do nothing;
    end if;
  end loop;
  insert into public.visit_outcomes(order_id, doctor_id, none_performed) values (p_order, v_pid, coalesce(p_none, false))
  on conflict (order_id) do update set none_performed = excluded.none_performed, recorded_at = now();
  insert into public.notifications(user_id, kind, ref_id, info) values (v_o.customer_id, 'visit_summary_ready', p_order, 'ready');
end $$;

create or replace function public.patient_confirm_visit_summary(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not exists (select 1 from public.orders where id = p_order and customer_id = v_uid) then raise exception 'الحجز غير متاح' using errcode = '42501'; end if;
  update public.visit_outcomes set patient_confirmed_at = now() where order_id = p_order and patient_confirmed_at is null;
  if not found then raise exception 'لا يوجد ملخص جاهز للتأكيد' using errcode = '22023'; end if;
end $$;

create or replace function public.doctor_monthly_statement(p_month date)
returns table(procedure_name text, performed_count bigint, fee_total_egp bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(t.name, c.referral_label), count(*), coalesce(sum(l.fee_egp),0)
  from public.procedure_fee_ledger l join public.consultation_procedures c on c.id = l.consultation_procedure_id left join public.procedure_types t on t.id = c.procedure_type_id
  where l.doctor_id = public.current_provider_id() and l.month = date_trunc('month', p_month)::date group by 1 order by 1;
$$;
create or replace function public.staff_procedure_fee_report(p_month date)
returns table(doctor_id uuid, doctor_name text, performed_count bigint, fee_total_egp bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select l.doctor_id, p.display_name, count(*), sum(l.fee_egp)::bigint from public.procedure_fee_ledger l join public.providers p on p.id = l.doctor_id where l.month = date_trunc('month', p_month)::date group by 1,2 order by 2;
end $$;

-- changes an existing function (phase 2 candidate): a visit can only be completed after the outcome is recorded
create or replace function public.doctor_set_appointment_status(p_order uuid, p_to text, p_note text default null)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_pid uuid := public.current_provider_id(); v_order public.orders%rowtype; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if v_pid is null then raise exception 'الحساب ده مش مقدم خدمة معتمد' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order for update;
  if not found or v_order.provider_id is distinct from v_pid then raise exception 'الحجز ده مش تبعك' using errcode = '42501'; end if;
  v_ok := (v_order.status, p_to) in (('new','confirmed'),('new','cancelled'),('confirmed','in_progress'),('confirmed','cancelled'),('in_progress','done'));
  if not v_ok then raise exception 'التغيير ده مش مسموح' using errcode = '42501'; end if;
  if p_to = 'done' and v_order.sector = 'clinic' and not exists (select 1 from public.visit_outcomes where order_id = p_order) then
    raise exception 'سجل الإجراءات المنفذة (أو لا شيء) قبل إنهاء الزيارة' using errcode = '22023';
  end if;
  update public.orders set status = p_to, updated_at = now() where id = p_order;
  insert into public.order_events (order_id, actor_id, from_status, to_status, note) values (p_order, auth.uid(), v_order.status, p_to, coalesce(p_note, 'من الطبيب'));
end $$;

do $$ declare f text; begin
  foreach f in array array['staff_set_procedure_type(integer,text,text,boolean,integer)','staff_set_doctor_procedure_price(uuid,integer,integer)','staff_set_procedure_referral_fee(boolean)','doctor_set_offered_procedures(integer[])','doctor_bookable_procedures(uuid)','customer_pick_booking_addons(uuid,integer[])','doctor_request_procedure(uuid,integer,text,text)','patient_decide_procedure(uuid,boolean)','doctor_record_visit_outcome(uuid,uuid[],uuid[],boolean)','patient_confirm_visit_summary(uuid)','doctor_monthly_statement(date)','staff_procedure_fee_report(date)','doctor_set_appointment_status(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
