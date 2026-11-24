-- wasla-test ONLY. Draft education journey (original requirement 2): teachers publish sessions, students enroll.
-- NOT a production migration. Synthetic data only. No payment is collected: price is informational (paid to the teacher outside Wasla).
create table if not exists public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.providers(id),
  title text not null check (char_length(title) between 3 and 120),
  subject text not null check (char_length(subject) between 2 and 60),
  starts_at timestamptz not null,
  duration_min int not null default 60 check (duration_min between 15 and 240),
  mode text not null default 'online' check (mode in ('online','in_person')),
  seats int not null check (seats between 1 and 30),
  price_egp int not null default 0 check (price_egp >= 0 and price_egp <= 5000),
  status text not null default 'open' check (status in ('open','cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.session_enrollments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutor_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now()
);
create unique index if not exists session_enrollments_one_active on public.session_enrollments(session_id, student_id) where status='booked';
alter table public.tutor_sessions enable row level security;
alter table public.session_enrollments enable row level security;
create policy sessions_read on public.tutor_sessions for select to authenticated using (
  (status='open' and starts_at > now() and exists(select 1 from public.providers p where p.id=teacher_id and p.kind='teacher' and p.approved and p.active and not p.is_test))
  or exists(select 1 from public.providers p where p.id=teacher_id and p.user_id=(select auth.uid())) or public.is_staff());
create policy enroll_read on public.session_enrollments for select to authenticated using (
  student_id=(select auth.uid()) or public.is_staff()
  or exists(select 1 from public.tutor_sessions s join public.providers p on p.id=s.teacher_id where s.id=session_id and p.user_id=(select auth.uid())));
grant select on public.tutor_sessions, public.session_enrollments to authenticated;

create or replace function public.teacher_create_session(p_title text, p_subject text, p_starts timestamptz, p_minutes int, p_mode text, p_seats int, p_price int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_id uuid;
begin
  select id into v_t from public.providers where user_id=(select auth.uid()) and kind='teacher' and approved and active and not is_test;
  if v_t is null then raise exception 'الحساب ده مش مدرس معتمد' using errcode='42501'; end if;
  if p_starts <= now() + interval '1 hour' then raise exception 'الموعد لازم يكون بعد ساعة على الأقل' using errcode='22023'; end if;
  insert into public.tutor_sessions(teacher_id,title,subject,starts_at,duration_min,mode,seats,price_egp)
  values (v_t, trim(p_title), trim(p_subject), p_starts, p_minutes, p_mode, p_seats, p_price) returning id into v_id;
  return v_id;
end $$;

create or replace function public.enroll_in_session(p_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_s public.tutor_sessions%rowtype; v_taken int; v_id uuid;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  if (select role from public.profiles where id=v_uid) is distinct from 'customer' then
    raise exception 'التسجيل متاح لحسابات العملاء فقط' using errcode='42501'; end if;
  if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms')
       and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
  select * into v_s from public.tutor_sessions where id=p_session for update;
  if not found or v_s.status<>'open' or v_s.starts_at <= now() then raise exception 'الحصة دي مش متاحة' using errcode='22023'; end if;
  if not exists(select 1 from public.providers p where p.id=v_s.teacher_id and p.kind='teacher' and p.approved and p.active and not p.is_test) then
    raise exception 'الحصة دي مش متاحة' using errcode='22023'; end if;
  if exists(select 1 from public.providers p where p.id=v_s.teacher_id and p.user_id=v_uid) then
    raise exception 'لا يمكن التسجيل في حصتك' using errcode='42501'; end if;
  if exists(select 1 from public.session_enrollments where session_id=p_session and student_id=v_uid and status='booked') then
    raise exception 'انت مسجل في الحصة دي بالفعل' using errcode='22023'; end if;
  select count(*) into v_taken from public.session_enrollments where session_id=p_session and status='booked';
  if v_taken >= v_s.seats then raise exception 'الحصة مكتملة العدد' using errcode='22023'; end if;
  insert into public.session_enrollments(session_id,student_id) values (p_session, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_enrollment(p_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.session_enrollments e set status='cancelled'
   where e.id=p_enrollment and e.student_id=(select auth.uid()) and e.status='booked'
     and exists(select 1 from public.tutor_sessions s where s.id=e.session_id and s.starts_at > now() + interval '2 hours');
  if not found then raise exception 'لا يمكن الإلغاء الآن' using errcode='42501'; end if;
end $$;

create or replace function public.teacher_cancel_session(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.tutor_sessions s set status='cancelled'
   where s.id=p_session and s.status='open'
     and exists(select 1 from public.providers p where p.id=s.teacher_id and p.user_id=(select auth.uid()) and p.kind='teacher' and p.approved and p.active);
  if not found then raise exception 'لا يمكن إلغاء الحصة' using errcode='42501'; end if;
  update public.session_enrollments set status='cancelled' where session_id=p_session and status='booked';
end $$;

revoke all on function public.teacher_create_session(text,text,timestamptz,int,text,int,int), public.enroll_in_session(uuid),
  public.cancel_enrollment(uuid), public.teacher_cancel_session(uuid) from public, anon;
grant execute on function public.teacher_create_session(text,text,timestamptz,int,text,int,int), public.enroll_in_session(uuid),
  public.cancel_enrollment(uuid), public.teacher_cancel_session(uuid) to authenticated;
