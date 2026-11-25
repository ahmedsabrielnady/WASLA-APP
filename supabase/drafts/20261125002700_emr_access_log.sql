-- wasla-test ONLY draft (not a production migration). SYNTHETIC data only. Requires 0900 (medical_notes, doctor_add_note) and clinic orders.
-- Minimal EMR doctor access: a doctor opens a patient file only for a patient with a clinic/nursing order with that doctor.
-- Every open writes one audit row (who, which patient, when; never content). The patient can read their own access rows.
create table if not exists public.emr_access_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  patient_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('doctor_open_file')),
  created_at timestamptz not null default now()
);
create index if not exists emr_access_log_patient_idx on public.emr_access_log(patient_id, created_at desc);
alter table public.emr_access_log enable row level security;
revoke all on public.emr_access_log from public, anon, authenticated;
grant select on public.emr_access_log to authenticated;
drop policy if exists emr_log_read on public.emr_access_log;
create policy emr_log_read on public.emr_access_log for select to authenticated using (patient_id = (select auth.uid()) or public.is_staff());

create or replace function public.doctor_open_patient_file(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_doc uuid; v_orders jsonb; v_notes jsonb;
begin
  if v_uid is null then raise exception 'auth required' using errcode='28000'; end if;
  select p.id into v_doc from public.providers p where p.user_id = v_uid and p.kind = 'doctor' and p.approved and p.active and p.is_test = false;
  if v_doc is null then raise exception 'not an approved doctor' using errcode='42501'; end if;
  if not exists (select 1 from public.orders o where o.customer_id = p_patient and o.provider_id = v_doc and o.sector in ('clinic','nursing')) then
    raise exception 'no care relationship with this patient' using errcode='42501'; end if;
  insert into public.emr_access_log(actor_id, patient_id, kind) values (v_uid, p_patient, 'doctor_open_file');
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'scheduled_at', o.scheduled_at, 'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
    into v_orders from public.orders o where o.customer_id = p_patient and o.provider_id = v_doc and o.sector in ('clinic','nursing');
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'order_id', n.order_id, 'note', n.note, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
    into v_notes from public.medical_notes n where n.patient_id = p_patient and n.doctor_id = v_doc;
  return jsonb_build_object('orders', v_orders, 'notes', v_notes);
end $$;
revoke all on function public.doctor_open_patient_file(uuid) from public, anon;
grant execute on function public.doctor_open_patient_file(uuid) to authenticated;
