-- DRAFT (not a migration). Medical notes: doctor adds a note through a checked RPC; the patient can read only their own notes.
-- Synthetic data only. Applying to production needs owner approval and a privacy review of health data.
drop policy if exists notes_patient_read on public.medical_notes;
create policy notes_patient_read on public.medical_notes for select to authenticated
  using (patient_id = (select auth.uid()));
create or replace function public.doctor_add_note(p_order uuid, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_doc uuid; v_o public.orders%rowtype; v_id bigint; v_n text := btrim(coalesce(p_note,''));
begin
  if v_uid is null then raise exception 'auth required' using errcode='28000'; end if;
  if char_length(v_n) < 3 or char_length(v_n) > 2000 then raise exception 'note length 3-2000' using errcode='22023'; end if;
  select p.id into v_doc from public.providers p
    where p.user_id=v_uid and p.kind='doctor' and p.approved and p.active and p.is_test=false;
  if v_doc is null then raise exception 'not an approved doctor' using errcode='42501'; end if;
  select * into v_o from public.orders where id=p_order and provider_id=v_doc and sector in ('clinic','nursing');
  if not found then raise exception 'order not found' using errcode='42501'; end if;
  insert into public.medical_notes(doctor_id,patient_id,order_id,note) values (v_doc,v_o.customer_id,v_o.id,v_n) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.doctor_add_note(uuid,text) from public, anon;
grant execute on function public.doctor_add_note(uuid,text) to authenticated;
