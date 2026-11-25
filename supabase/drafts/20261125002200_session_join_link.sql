-- wasla-test ONLY draft (not a production migration). Teacher-provided external meeting URL for online sessions.
-- Free: Wasla hosts no video. The teacher pastes a link from any external service they already use. No time window is assumed (a product decision, not requested by the user).
-- The link lives in its own table so the public session list can never expose it. Synthetic data only.
create table if not exists public.session_join_links (
  session_id uuid primary key references public.tutor_sessions(id) on delete cascade,
  url text not null check (char_length(url) between 12 and 300 and url ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'),
  updated_at timestamptz not null default now()
);
alter table public.session_join_links enable row level security;
create policy join_link_read on public.session_join_links for select to authenticated using (
  public.is_staff()
  or exists(select 1 from public.tutor_sessions s join public.providers p on p.id=s.teacher_id where s.id=session_id and p.user_id=(select auth.uid()))
  or exists(select 1 from public.session_enrollments e join public.tutor_sessions s on s.id=e.session_id
            where e.session_id=session_join_links.session_id and e.student_id=(select auth.uid()) and e.status='booked' and s.status='open'));
revoke all on public.session_join_links from anon, authenticated;
grant select on public.session_join_links to authenticated;

create or replace function public.teacher_set_session_link(p_session uuid, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_s public.tutor_sessions%rowtype; v_u text := trim(p_url);
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  select s.* into v_s from public.tutor_sessions s join public.providers p on p.id=s.teacher_id
   where s.id=p_session and p.user_id=v_uid and p.kind='teacher' and p.approved and p.active and not p.is_test;
  if not found then raise exception 'الحصة مش بتاعتك' using errcode='42501'; end if;
  if v_s.mode<>'online' or v_s.status<>'open' then raise exception 'الرابط للحصص الأونلاين المفتوحة فقط' using errcode='22023'; end if;
  if v_u is null or v_u !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' or char_length(v_u) not between 12 and 300 then
    raise exception 'الرابط لازم يبدأ بـ https:// وبدون مسافات' using errcode='22023'; end if;
  insert into public.session_join_links(session_id,url) values (p_session, v_u)
  on conflict (session_id) do update set url=excluded.url, updated_at=now();
end $$;
revoke all on function public.teacher_set_session_link(uuid,text) from public, anon;
grant execute on function public.teacher_set_session_link(uuid,text) to authenticated;
