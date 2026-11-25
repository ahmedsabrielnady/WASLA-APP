-- wasla-test ONLY draft (not a production migration). Course enrollment. Synthetic data only. No payment is collected.
alter table public.courses add column if not exists seats int not null default 20 check (seats between 1 and 200);
create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now()
);
create unique index if not exists course_enrollments_one_active on public.course_enrollments(course_id, student_id) where status='booked';
create index if not exists course_enrollments_student_idx on public.course_enrollments(student_id);
alter table public.course_enrollments enable row level security;
create policy cenroll_read on public.course_enrollments for select to authenticated using (
  student_id=(select auth.uid()) or public.is_staff()
  or exists(select 1 from public.courses c join public.providers p on p.id=c.teacher_id where c.id=course_id and p.user_id=(select auth.uid())));
grant select on public.course_enrollments to authenticated;
create or replace function public.course_seats_taken(p_course uuid) returns int language sql stable security definer set search_path = '' as $$
  select case when exists(select 1 from public.courses c where c.id=p_course and c.active and public.is_listed_teacher(c.teacher_id))
    then (select count(*)::int from public.course_enrollments e where e.course_id=p_course and e.status='booked') else null end $$;
create or replace function public.enroll_in_course(p_course uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_c public.courses%rowtype; v_taken int; v_id uuid;
begin
  if v_uid is null then raise exception 'auth required' using errcode='42501'; end if;
  if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
    raise exception 'consent required' using errcode='42501'; end if;
  select * into v_c from public.courses where id=p_course for update;
  if not found or not v_c.active or not public.is_listed_teacher(v_c.teacher_id) then raise exception 'course unavailable' using errcode='22023'; end if;
  if exists(select 1 from public.providers p where p.id=v_c.teacher_id and p.user_id=v_uid) then raise exception 'cannot enroll in own course' using errcode='42501'; end if;
  if exists(select 1 from public.course_enrollments where course_id=p_course and student_id=v_uid and status='booked') then raise exception 'already enrolled' using errcode='22023'; end if;
  select count(*) into v_taken from public.course_enrollments where course_id=p_course and status='booked';
  if v_taken >= v_c.seats then raise exception 'course full' using errcode='22023'; end if;
  insert into public.course_enrollments(course_id,student_id) values (p_course, v_uid) returning id into v_id;
  return v_id;
end $$;
create or replace function public.cancel_course_enrollment(p_enrollment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.course_enrollments e set status='cancelled' where e.id=p_enrollment and e.student_id=(select auth.uid()) and e.status='booked';
  if not found then raise exception 'cannot cancel' using errcode='42501'; end if;
end $$;
-- teacher_create_course gets a seats argument (drop the old signature so only one exists)
drop function if exists public.teacher_create_course(text,text,text,int,text,int);
create or replace function public.teacher_create_course(p_title text, p_subject text, p_description text, p_lessons int, p_mode text, p_price int, p_seats int default 20) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_id uuid; v_n int;
begin
  select id into v_t from public.providers where user_id=(select auth.uid()) and kind='teacher' and approved and active and not is_test;
  if v_t is null then raise exception 'not an approved teacher' using errcode='42501'; end if;
  select count(*) into v_n from public.courses where teacher_id=v_t and active;
  if v_n >= 20 then raise exception 'too many active courses' using errcode='22023'; end if;
  insert into public.courses(teacher_id,title,subject,description,lessons,mode,price_egp,seats)
  values (v_t, btrim(p_title), btrim(p_subject), btrim(coalesce(p_description,'')), p_lessons, p_mode, p_price, p_seats) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.course_seats_taken(uuid), public.enroll_in_course(uuid), public.cancel_course_enrollment(uuid), public.teacher_create_course(text,text,text,int,text,int,int) from public, anon;
grant execute on function public.course_seats_taken(uuid), public.enroll_in_course(uuid), public.cancel_course_enrollment(uuid), public.teacher_create_course(text,text,text,int,text,int,int) to authenticated;
