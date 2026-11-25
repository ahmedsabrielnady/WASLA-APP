-- wasla-test ONLY draft (not a production migration). Education catalogue: tutor profile and courses. Synthetic data only.
-- No payment is collected. Price is informational and paid to the teacher outside Wasla.
create table if not exists public.tutor_profiles (
  teacher_id uuid primary key references public.providers(id) on delete cascade,
  headline text not null check (char_length(headline) between 3 and 100),
  bio text not null default '' check (char_length(bio) <= 1000),
  subjects text[] not null default '{}' check (cardinality(subjects) <= 8),
  updated_at timestamptz not null default now()
);
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.providers(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  subject text not null check (char_length(subject) between 2 and 60),
  description text not null default '' check (char_length(description) <= 1000),
  lessons int not null check (lessons between 1 and 200),
  mode text not null default 'online' check (mode in ('online','in_person')),
  price_egp int not null default 0 check (price_egp between 0 and 20000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists courses_teacher_idx on public.courses(teacher_id);
alter table public.tutor_profiles enable row level security;
alter table public.courses enable row level security;
create or replace function public.is_listed_teacher(p_provider uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.providers p where p.id=p_provider and p.kind='teacher' and p.approved and p.active and not p.is_test) $$;
revoke all on function public.is_listed_teacher(uuid) from public, anon;
grant execute on function public.is_listed_teacher(uuid) to authenticated;
create policy tprof_read on public.tutor_profiles for select to authenticated using (
  public.is_listed_teacher(teacher_id) or exists(select 1 from public.providers p where p.id=teacher_id and p.user_id=(select auth.uid())) or public.is_staff());
create policy courses_read on public.courses for select to authenticated using (
  (active and public.is_listed_teacher(teacher_id)) or exists(select 1 from public.providers p where p.id=teacher_id and p.user_id=(select auth.uid())) or public.is_staff());
grant select on public.tutor_profiles, public.courses to authenticated;

create or replace function public.teacher_upsert_profile(p_headline text, p_bio text, p_subjects text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_subj text[];
begin
  select id into v_t from public.providers where user_id=(select auth.uid()) and kind='teacher' and approved and active and not is_test;
  if v_t is null then raise exception 'not an approved teacher' using errcode='42501'; end if;
  select coalesce(array_agg(s),'{}') into v_subj from (select distinct btrim(x) s from unnest(coalesce(p_subjects,'{}')) x where char_length(btrim(x)) between 2 and 40 limit 8) q;
  insert into public.tutor_profiles(teacher_id,headline,bio,subjects) values (v_t, btrim(p_headline), btrim(coalesce(p_bio,'')), v_subj)
  on conflict (teacher_id) do update set headline=excluded.headline, bio=excluded.bio, subjects=excluded.subjects, updated_at=now();
end $$;
create or replace function public.teacher_create_course(p_title text, p_subject text, p_description text, p_lessons int, p_mode text, p_price int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_id uuid; v_n int;
begin
  select id into v_t from public.providers where user_id=(select auth.uid()) and kind='teacher' and approved and active and not is_test;
  if v_t is null then raise exception 'not an approved teacher' using errcode='42501'; end if;
  select count(*) into v_n from public.courses where teacher_id=v_t and active;
  if v_n >= 20 then raise exception 'too many active courses' using errcode='22023'; end if;
  insert into public.courses(teacher_id,title,subject,description,lessons,mode,price_egp)
  values (v_t, btrim(p_title), btrim(p_subject), btrim(coalesce(p_description,'')), p_lessons, p_mode, p_price) returning id into v_id;
  return v_id;
end $$;
create or replace function public.teacher_set_course_active(p_course uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.courses c set active=p_active where c.id=p_course
    and exists(select 1 from public.providers p where p.id=c.teacher_id and p.user_id=(select auth.uid()) and p.kind='teacher' and p.approved and p.active and not p.is_test);
  if not found then raise exception 'course not found' using errcode='42501'; end if;
end $$;
revoke all on function public.teacher_upsert_profile(text,text,text[]), public.teacher_create_course(text,text,text,int,text,int), public.teacher_set_course_active(uuid,boolean) from public, anon;
grant execute on function public.teacher_upsert_profile(text,text,text[]), public.teacher_create_course(text,text,text,int,text,int), public.teacher_set_course_active(uuid,boolean) to authenticated;
