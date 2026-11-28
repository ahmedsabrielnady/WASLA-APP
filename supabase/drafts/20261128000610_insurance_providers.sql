-- wasla-test ONLY. Draft, not a production migration. Requires 0600_procedures.
-- Lightweight medical insurance support. NO claims, approvals or billing: an insured visit is only a flag.
-- The member number is sensitive health-adjacent data: stored privately, readable by the patient and by the doctor assigned to an insured booking of that patient.
create table if not exists public.insurers (
  id serial primary key,
  name text not null unique check (char_length(name) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.patient_insurance (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  insurer_id integer not null references public.insurers(id),
  member_number text not null check (char_length(member_number) between 4 and 40),
  consent_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patient_insurance_insurer_idx on public.patient_insurance(insurer_id);
-- any provider type (doctor, pharmacy, lab, imaging). The founder assigns insurers; a provider may declare its own, which stays pending until the founder approves.
create table if not exists public.provider_insurers (
  provider_id uuid not null references public.providers(id) on delete cascade,
  insurer_id integer not null references public.insurers(id) on delete cascade,
  status text not null default 'pending' check (status in ('approved','pending')),
  declared_by text not null default 'provider' check (declared_by in ('founder','provider')),
  created_at timestamptz not null default now(),
  primary key (provider_id, insurer_id)
);
create index if not exists provider_insurers_insurer_idx on public.provider_insurers(insurer_id);
do $$ begin
  if to_regclass('public.doctor_insurers') is not null then
    insert into public.provider_insurers(provider_id, insurer_id, status, declared_by) select doctor_id, insurer_id, 'pending', 'provider' from public.doctor_insurers on conflict do nothing;
    drop function if exists public.doctor_set_accepted_insurers(integer[]);
    drop function if exists public.doctor_insurance_for_booking(uuid);
    drop table public.doctor_insurers;
  end if;
end $$;
alter table public.orders add column if not exists insured boolean not null default false;
alter table public.orders add column if not exists insurer_id integer references public.insurers(id);
create index if not exists orders_insurer_idx on public.orders(insurer_id) where insurer_id is not null;
alter table public.procedure_settings add column if not exists insured_fee_mode text not null default 'waive' check (insured_fee_mode in ('waive','same'));
alter table public.insurers enable row level security;
alter table public.patient_insurance enable row level security;
alter table public.provider_insurers enable row level security;
revoke all on public.insurers, public.patient_insurance, public.provider_insurers from anon, authenticated;
grant select on public.insurers, public.provider_insurers to authenticated;
grant select on public.patient_insurance to authenticated;
drop policy if exists insurers_read on public.insurers;
create policy insurers_read on public.insurers for select to authenticated using (active or (select public.is_staff()));
drop policy if exists provider_insurers_read on public.provider_insurers;
create policy provider_insurers_read on public.provider_insurers for select to authenticated using (status = 'approved' or provider_id = (select public.current_provider_id()) or (select public.is_staff()));
drop policy if exists patient_insurance_owner on public.patient_insurance;
create policy patient_insurance_owner on public.patient_insurance for select to authenticated using (patient_id = (select auth.uid()));

create or replace function public.staff_set_insurer(p_id integer, p_name text, p_active boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id integer;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_id is null then insert into public.insurers(name, active) values (btrim(p_name), coalesce(p_active, true)) returning id into v_id;
  else update public.insurers set name = btrim(p_name), active = coalesce(p_active, active) where id = p_id returning id into v_id; end if;
  if v_id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  return v_id;
end $$;
create or replace function public.staff_set_insured_fee_mode(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_mode not in ('waive','same') then raise exception 'قيمة غير صالحة' using errcode = '22023'; end if;
  update public.procedure_settings set insured_fee_mode = p_mode, updated_at = now() where id = 1;
end $$;
-- consent must be given explicitly: p_consent true, text shown in the app: "أوافق على حفظ بيانات تأميني الصحي بشكل خاص ومشاركته مع الطبيب المسند له حجزي فقط."
create or replace function public.customer_save_insurance(p_insurer integer, p_member text, p_consent boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  if not coalesce(p_consent, false) then raise exception 'لازم توافق على حفظ بيانات التأمين' using errcode = '22023'; end if;
  if not exists (select 1 from public.insurers where id = p_insurer and active) then raise exception 'شركة التأمين غير متاحة' using errcode = '22023'; end if;
  insert into public.patient_insurance(patient_id, insurer_id, member_number, consent_at) values (v_uid, p_insurer, btrim(p_member), now())
  on conflict (patient_id) do update set insurer_id = excluded.insurer_id, member_number = excluded.member_number, consent_at = now(), updated_at = now();
end $$;
create or replace function public.customer_remove_insurance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  delete from public.patient_insurance where patient_id = auth.uid();
end $$;
-- founder: assign (approve) the insurers a provider is contracted with
create or replace function public.staff_set_provider_insurers(p_provider uuid, p_insurers integer[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if not exists (select 1 from public.providers where id = p_provider) then raise exception 'مقدم الخدمة غير موجود' using errcode = 'P0002'; end if;
  delete from public.provider_insurers where provider_id = p_provider and insurer_id <> all(coalesce(p_insurers,'{}'));
  insert into public.provider_insurers(provider_id, insurer_id, status, declared_by) select p_provider, i.id, 'approved', 'founder' from public.insurers i where i.active and i.id = any(coalesce(p_insurers,'{}'))
  on conflict (provider_id, insurer_id) do update set status = 'approved', declared_by = 'founder';
end $$;
-- optional: a provider declares what it accepts. Stays pending until the founder approves, and does not touch founder-approved rows.
create or replace function public.provider_declare_insurers(p_insurers integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := public.current_provider_id();
begin
  if auth.uid() is null or v_pid is null then raise exception 'سجل دخولك كمقدم خدمة' using errcode = '42501'; end if;
  delete from public.provider_insurers where provider_id = v_pid and status = 'pending' and insurer_id <> all(coalesce(p_insurers,'{}'));
  insert into public.provider_insurers(provider_id, insurer_id, status, declared_by) select v_pid, i.id, 'pending', 'provider' from public.insurers i where i.active and i.id = any(coalesce(p_insurers,'{}')) on conflict do nothing;
end $$;
create or replace function public.staff_approve_provider_insurer(p_provider uuid, p_insurer integer, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_approve then update public.provider_insurers set status = 'approved' where provider_id = p_provider and insurer_id = p_insurer;
  else delete from public.provider_insurers where provider_id = p_provider and insurer_id = p_insurer and status = 'pending'; end if;
end $$;
-- booking/listing: insurers this provider accepts (approved only) and whether the signed-in patient's insurer is among them (no member number returned)
create or replace function public.provider_insurance_for_booking(p_provider uuid)
returns table(accepted_insurers text[], patient_has_insurance boolean, patient_insurer text, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce((select array_agg(i.name order by i.name) from public.provider_insurers d join public.insurers i on i.id = d.insurer_id where d.provider_id = p_provider and d.status = 'approved' and i.active), '{}'),
         exists (select 1 from public.patient_insurance where patient_id = auth.uid()),
         (select i.name from public.patient_insurance pi join public.insurers i on i.id = pi.insurer_id where pi.patient_id = auth.uid()),
         exists (select 1 from public.patient_insurance pi join public.provider_insurers d on d.insurer_id = pi.insurer_id and d.status = 'approved' where pi.patient_id = auth.uid() and d.provider_id = p_provider)
  where auth.uid() is not null;
$$;
-- customer filter: providers (by kind and optional specialty) that accept an insurer. Shows no private data.
create or replace function public.providers_accepting_insurer(p_insurer integer, p_kind text default null, p_specialty text default null)
returns table(provider_id uuid, display_name text, kind text, specialty text, area text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.kind, p.specialty, p.area from public.providers p join public.provider_insurers d on d.provider_id = p.id and d.status = 'approved'
  where d.insurer_id = p_insurer and p.approved and p.active and not p.is_test and auth.uid() is not null
    and (p_kind is null or p.kind = p_kind) and (p_specialty is null or p.specialty = p_specialty) order by p.display_name;
$$;
-- mark a booking as insured (snapshot of the insurer id only; the member number is not copied)
create or replace function public.customer_set_order_insurance(p_order uuid, p_use boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.orders%rowtype; v_ins integer;
begin
  if v_uid is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.customer_id <> v_uid then raise exception 'الحجز غير متاح' using errcode = '42501'; end if;
  if v_o.status not in ('new','confirmed') then raise exception 'لا يمكن تغيير التأمين بعد بدء الكشف' using errcode = '22023'; end if;
  if coalesce(p_use, false) then
    select insurer_id into v_ins from public.patient_insurance where patient_id = v_uid;
    if v_ins is null then raise exception 'احفظ بيانات تأمينك الأول' using errcode = '22023'; end if;
    if v_o.provider_id is null or not exists (select 1 from public.provider_insurers where provider_id = v_o.provider_id and insurer_id = v_ins and status = 'approved') then raise exception 'مقدم الخدمة ده مش بيقبل شركة التأمين دي' using errcode = '22023'; end if;
    update public.orders set insured = true, insurer_id = v_ins where id = p_order;
  else update public.orders set insured = false, insurer_id = null where id = p_order; end if;
end $$;
-- doctor, insured booking assigned to him only: the member number for the visit
create or replace function public.doctor_get_insured_member(p_order uuid)
returns table(insurer text, member_number text)
language sql stable security definer set search_path = '' as $$
  select i.name, pi.member_number from public.orders o join public.patient_insurance pi on pi.patient_id = o.customer_id join public.insurers i on i.id = pi.insurer_id
  where o.id = p_order and o.insured and o.provider_id = public.current_provider_id() and o.status in ('new','confirmed','in_progress','done') and auth.uid() is not null;
$$;
-- founder: limited view, last 4 characters only
create or replace function public.staff_insured_orders_summary()
returns table(insurer text, orders_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select i.name, count(*) from public.orders o join public.insurers i on i.id = o.insurer_id where o.insured group by 1 order by 1;
end $$;
-- fee accrual honours the insured fee mode (replaces the 0600 version)
create or replace function public.doctor_record_visit_outcome(p_order uuid, p_performed uuid[], p_cancelled uuid[], p_none boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := public.current_provider_id(); v_o public.orders%rowtype; v_apply_ref boolean; v_mode text; r record; v_open integer;
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
  select fee_applies_to_referrals, insured_fee_mode into v_apply_ref, v_mode from public.procedure_settings where id = 1;
  for r in select * from public.consultation_procedures c where c.order_id = p_order and c.status = 'confirmed' and c.id = any(coalesce(p_performed,'{}')) loop
    update public.consultation_procedures set status = 'performed', performed_at = now() where id = r.id;
    if r.fee_snapshot_egp is not null and (r.procedure_type_id is not null or coalesce(v_apply_ref,false)) and not (v_o.insured and v_mode = 'waive') then
      insert into public.procedure_fee_ledger(consultation_procedure_id, doctor_id, fee_egp, month) values (r.id, v_pid, r.fee_snapshot_egp, date_trunc('month', now())::date) on conflict (consultation_procedure_id) do nothing;
    end if;
  end loop;
  insert into public.visit_outcomes(order_id, doctor_id, none_performed) values (p_order, v_pid, coalesce(p_none, false))
  on conflict (order_id) do update set none_performed = excluded.none_performed, recorded_at = now();
  insert into public.notifications(user_id, kind, ref_id, info) values (v_o.customer_id, 'visit_summary_ready', p_order, 'ready');
end $$;
do $$ declare f text; begin
  foreach f in array array['staff_set_insurer(integer,text,boolean)','staff_set_insured_fee_mode(text)','customer_save_insurance(integer,text,boolean)','customer_remove_insurance()','staff_set_provider_insurers(uuid,integer[])','provider_declare_insurers(integer[])','staff_approve_provider_insurer(uuid,integer,boolean)','provider_insurance_for_booking(uuid)','providers_accepting_insurer(integer,text,text)','customer_set_order_insurance(uuid,boolean)','doctor_get_insured_member(uuid)','staff_insured_orders_summary()','doctor_record_visit_outcome(uuid,uuid[],uuid[],boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
