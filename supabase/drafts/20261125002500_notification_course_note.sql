-- wasla-test ONLY draft (not a production migration). Two more generic notification sources, same rule as drafts 2000/2300:
-- a row holds a kind and a reference id only, never a price, title, note text or health detail.
--   'doctor_note'    : the patient is told a doctor added a note to one of their clinic/nursing orders (ref = that order id).
--   'course_changed' : students with a booked enrollment are told a course's price, mode, lesson count or availability changed (ref = course id).
-- Lab and radiology price changes are NOT built here: no lab order or subscription exists, so there is no defined recipient. Open item.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'order_status','order_scheduled','change_request_applied','change_request_declined',
  'delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised',
  'doctor_note','course_changed'));

create or replace function public.notify_doctor_note() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.patient_id is not null and new.order_id is not null then
    insert into public.notifications(user_id, kind, ref_id) values (new.patient_id, 'doctor_note', new.order_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_doctor_note() from public, anon, authenticated;
drop trigger if exists medical_notes_notify on public.medical_notes;
create trigger medical_notes_notify after insert on public.medical_notes for each row execute function public.notify_doctor_note();

create or replace function public.notify_course_changed() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.price_egp is distinct from old.price_egp or new.mode is distinct from old.mode
     or new.lessons is distinct from old.lessons or new.active is distinct from old.active then
    insert into public.notifications(user_id, kind, ref_id)
    select e.student_id, 'course_changed', new.id from public.course_enrollments e where e.course_id = new.id and e.status = 'booked';
  end if;
  return new;
end $$;
revoke all on function public.notify_course_changed() from public, anon, authenticated;
drop trigger if exists courses_notify on public.courses;
create trigger courses_notify after update on public.courses for each row execute function public.notify_course_changed();
