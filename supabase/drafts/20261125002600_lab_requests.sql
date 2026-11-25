-- wasla-test ONLY draft (not a production migration). SYNTHETIC data only: never store real results. Requires 0500 (lab_tests), 2000/2500 (notifications).
-- Lab and radiology requests with a result published by the owning provider. Wasla collects no payment; the price is a snapshot of the catalogue.
-- Results are short text only in this draft. File results would reuse the private-bucket pattern and inherit its open release gates.
create table if not exists public.lab_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.providers(id),
  test_id uuid not null references public.lab_tests(id),
  price_egp int not null check (price_egp between 1 and 20000),
  status text not null default 'requested' check (status in ('requested','sample_done','result_ready','cancelled')),
  result_text text check (result_text is null or char_length(result_text) between 3 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'result_ready') = (result_text is not null))
);
create index if not exists lab_requests_patient_idx on public.lab_requests(patient_id, created_at desc);
create index if not exists lab_requests_provider_idx on public.lab_requests(provider_id, created_at desc);
alter table public.lab_requests enable row level security;
revoke all on public.lab_requests from public, anon, authenticated;
grant select on public.lab_requests to authenticated;
drop policy if exists lab_requests_read on public.lab_requests;
create policy lab_requests_read on public.lab_requests for select to authenticated using (
  patient_id = (select auth.uid()) or public.is_staff()
  or exists(select 1 from public.providers p where p.id = provider_id and p.user_id = (select auth.uid())));

create or replace function public.request_lab_test(p_test uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_t public.lab_tests%rowtype; v_id uuid; v_open int;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
  select t.* into v_t from public.lab_tests t join public.providers p on p.id = t.provider_id
    where t.id = p_test and t.active and p.kind='merchant' and p.specialty in ('lab','radiology') and p.approved and p.active and not p.is_test;
  if not found then raise exception 'التحليل ده مش متاح' using errcode='42501'; end if;
  select count(*) into v_open from public.lab_requests where patient_id = v_uid and status in ('requested','sample_done');
  if v_open >= 5 then raise exception 'عندك 5 طلبات مفتوحة بالفعل' using errcode='53400'; end if;
  insert into public.lab_requests(patient_id, provider_id, test_id, price_egp) values (v_uid, v_t.provider_id, v_t.id, v_t.price_egp) returning id into v_id;
  return v_id;
end $$;

create or replace function public.lab_set_request_status(p_request uuid, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_r public.lab_requests%rowtype;
begin
  select r.* into v_r from public.lab_requests r join public.providers p on p.id = r.provider_id
    where r.id = p_request and p.user_id = v_uid and p.approved and p.active for update of r;
  if not found then raise exception 'الطلب غير موجود' using errcode='42501'; end if;
  if not (v_r.status = 'requested' and p_to = 'sample_done') then raise exception 'انتقال الحالة غير مسموح' using errcode='22023'; end if;
  update public.lab_requests set status = p_to, updated_at = now() where id = p_request;
end $$;

create or replace function public.lab_publish_result(p_request uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_r public.lab_requests%rowtype; v_n text := btrim(coalesce(p_text,''));
begin
  if char_length(v_n) < 3 or char_length(v_n) > 2000 then raise exception 'النتيجة من 3 إلى 2000 حرف' using errcode='22023'; end if;
  select r.* into v_r from public.lab_requests r join public.providers p on p.id = r.provider_id
    where r.id = p_request and p.user_id = v_uid and p.approved and p.active for update of r;
  if not found then raise exception 'الطلب غير موجود' using errcode='42501'; end if;
  if v_r.status <> 'sample_done' then raise exception 'انتقال الحالة غير مسموح' using errcode='22023'; end if;
  update public.lab_requests set status = 'result_ready', result_text = v_n, updated_at = now() where id = p_request;
end $$;

create or replace function public.patient_cancel_lab_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.lab_requests set status = 'cancelled', updated_at = now()
    where id = p_request and patient_id = (select auth.uid()) and status = 'requested';
  if not found then raise exception 'مينفعش تلغي الطلب ده' using errcode='22023'; end if;
end $$;

revoke all on function public.request_lab_test(uuid), public.lab_set_request_status(uuid,text), public.lab_publish_result(uuid,text), public.patient_cancel_lab_request(uuid) from public, anon;
grant execute on function public.request_lab_test(uuid), public.lab_set_request_status(uuid,text), public.lab_publish_result(uuid,text), public.patient_cancel_lab_request(uuid) to authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'order_status','order_scheduled','change_request_applied','change_request_declined',
  'delivery_status','prescription_quote','session_cancelled','session_link','prescription_quote_revised',
  'doctor_note','course_changed','lab_status','lab_result_ready'));

create or replace function public.notify_lab_request() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status and new.status in ('sample_done','result_ready') then
    insert into public.notifications(user_id, kind, ref_id)
    values (new.patient_id, case when new.status = 'result_ready' then 'lab_result_ready' else 'lab_status' end, new.id);
  end if;
  return new;
end $$;
revoke all on function public.notify_lab_request() from public, anon, authenticated;
drop trigger if exists lab_requests_notify on public.lab_requests;
create trigger lab_requests_notify after update of status on public.lab_requests for each row execute function public.notify_lab_request();
