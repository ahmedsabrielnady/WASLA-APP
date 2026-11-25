-- wasla-test ONLY draft (not a production migration). SYNTHETIC data only. Requires 0900 and 2700.
-- Doctors no longer read medical_notes by direct table select. Notes reach a doctor only through the audited
-- doctor_open_patient_file RPC (draft 2700), which writes one audit row per open. The patient's own read policy (notes_patient_read)
-- and the doctor's insert path (doctor_add_note / notes_doctor_write) are unchanged.
-- Audit coverage after this draft: doctor reads of NOTES are audited. Doctor reads of ORDERS (the normal appointment list) are NOT audited.
-- No staff select policy exists on medical_notes, so staff cannot read notes by table select; staff can read the audit log only.
drop policy if exists notes_doctor_read on public.medical_notes;
