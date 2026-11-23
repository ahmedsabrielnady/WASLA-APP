-- Security hardening: only approved, active, non-test doctors may read/write medical notes.
-- A medical note must be linked to the patient's assigned clinic or nursing order.
-- Only approved, active, non-test merchant accounts may manage products.

drop policy if exists notes_doctor_read on public.medical_notes;
create policy notes_doctor_read
on public.medical_notes
for select
to authenticated
using (
  doctor_id = (select public.current_provider_id())
  and exists (
    select 1 from public.providers p
    where p.id = medical_notes.doctor_id
      and p.user_id = (select auth.uid())
      and p.kind = 'doctor'
      and p.approved = true
      and p.active = true
      and p.is_test = false
  )
);

drop policy if exists notes_doctor_write on public.medical_notes;
create policy notes_doctor_write
on public.medical_notes
for insert
to authenticated
with check (
  doctor_id = (select public.current_provider_id())
  and exists (
    select 1 from public.providers p
    where p.id = medical_notes.doctor_id
      and p.user_id = (select auth.uid())
      and p.kind = 'doctor'
      and p.approved = true
      and p.active = true
      and p.is_test = false
  )
  and exists (
    select 1 from public.orders o
    where o.customer_id = medical_notes.patient_id
      and o.provider_id = medical_notes.doctor_id
      and o.sector in ('clinic', 'nursing')
  )
);

drop policy if exists products_merchant_write on public.products;
create policy products_merchant_write
on public.products
for all
to authenticated
using (
  exists (
    select 1
    from public.providers p
    join public.profiles pr on pr.id = p.user_id
    where p.id = products.merchant_id
      and p.user_id = (select auth.uid())
      and p.kind = 'merchant'
      and p.approved = true
      and p.active = true
      and p.is_test = false
      and pr.role = 'merchant'
  )
)
with check (
  exists (
    select 1
    from public.providers p
    join public.profiles pr on pr.id = p.user_id
    where p.id = products.merchant_id
      and p.user_id = (select auth.uid())
      and p.kind = 'merchant'
      and p.approved = true
      and p.active = true
      and p.is_test = false
      and pr.role = 'merchant'
  )
);
