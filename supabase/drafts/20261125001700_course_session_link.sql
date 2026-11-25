-- wasla-test ONLY draft (not a production migration). Course/session linkage. Synthetic data only. No payment is collected.
-- Rule drafted here (a product decision to confirm): a session linked to a course can only be booked by a student with a booked enrollment in that course.
-- Standalone sessions (course_id null) behave exactly as before. Cancelling a course enrollment cancels that student's future booked sessions of that course.
alter table public.tutor_sessions add column if not exists course_id uuid references public.courses(id) on delete set null;
create index if not exists tutor_sessions_course_idx on public.tutor_sessions(course_id) where course_id is not null;

create or replace function public.teacher_create_course_session(p_course uuid, p_title text, p_subject text, p_starts timestamptz, p_minutes int, p_mode text, p_seats int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_id uuid; v_price int;
begin
  select id into v_t from public.providers where user_id=(select auth.uid()) and kind='teacher' and approved and active and not is_test;
  if v_t is null then raise exception 'الحساب ده مش مدرس معتمد' using errcode='42501'; end if;
  select price_egp into v_price from public.courses where id=p_course and teacher_id=v_t and active;
  if not found then raise exception 'الدورة مش متاحة أو مش بتاعتك' using errcode='22023'; end if;
  if p_starts <= now() + interval '1 hour' then raise exception 'الموعد لازم يكون بعد ساعة على الأقل' using errcode='22023'; end if;
  insert into public.tutor_sessions(teacher_id,course_id,title,subject,starts_at,duration_min,mode,seats,price_egp)
  values (v_t, p_course, trim(p_title), trim(p_subject), p_starts, p_minutes, p_mode, p_seats, 0) returning id into v_id;
  return v_id;
end $$;

create or replace function public.enroll_in_session(p_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_s public.tutor_sessions%rowtype; v_taken int; v_id uuid;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms')
       and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
  select * into v_s from public.tutor_sessions where id=p_session for update;
  if not found or v_s.status<>'open' or v_s.starts_at <= now() then raise exception 'الحصة دي مش متاحة' using errcode='22023'; end if;
  if not exists(select 1 from public.providers p where p.id=v_s.teacher_id and p.kind='teacher' and p.approved and p.active and not p.is_test) then
    raise exception 'الحصة دي مش متاحة' using errcode='22023'; end if;
  if exists(select 1 from public.providers p where p.id=v_s.teacher_id and p.user_id=v_uid) then
    raise exception 'لا يمكن التسجيل في حصتك' using errcode='42501'; end if;
  if v_s.course_id is not null and not exists(select 1 from public.course_enrollments ce where ce.course_id=v_s.course_id and ce.student_id=v_uid and ce.status='booked') then
    raise exception 'سجل في الدورة الأول عشان تحجز حصصها' using errcode='42501'; end if;
  if exists(select 1 from public.session_enrollments where session_id=p_session and student_id=v_uid and status='booked') then
    raise exception 'انت مسجل في الحصة دي بالفعل' using errcode='22023'; end if;
  select count(*) into v_taken from public.session_enrollments where session_id=p_session and status='booked';
  if v_taken >= v_s.seats then raise exception 'الحصة مكتملة العدد' using errcode='22023'; end if;
  insert into public.session_enrollments(session_id,student_id) values (p_session, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_course_enrollment(p_enrollment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_course uuid;
begin
  update public.course_enrollments e set status='cancelled' where e.id=p_enrollment and e.student_id=(select auth.uid()) and e.status='booked' returning e.course_id into v_course;
  if not found then raise exception 'cannot cancel' using errcode='42501'; end if;
  update public.session_enrollments se set status='cancelled'
   where se.student_id=(select auth.uid()) and se.status='booked'
     and exists(select 1 from public.tutor_sessions s where s.id=se.session_id and s.course_id=v_course and s.starts_at > now());
end $$;

revoke all on function public.teacher_create_course_session(uuid,text,text,timestamptz,int,text,int), public.enroll_in_session(uuid), public.cancel_course_enrollment(uuid) from public, anon;
grant execute on function public.teacher_create_course_session(uuid,text,text,timestamptz,int,text,int), public.enroll_in_session(uuid), public.cancel_course_enrollment(uuid) to authenticated;
