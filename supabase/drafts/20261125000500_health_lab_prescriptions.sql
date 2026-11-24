-- wasla-test ONLY. Draft health extras (original requirement 1): priced lab/radiology catalogue and prescription requests answered by pharmacies.
-- NOT a production migration. SYNTHETIC data only: do not store real patient data. Prices are entered by each provider; nothing is charged by Wasla.
-- Providers are kind 'merchant' with specialty 'pharmacy', 'lab' or 'radiology' (no new provider kind, so no change to the kind constraint).
create table if not exists public.lab_tests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id),
  kind text not null check (kind in ('lab','radiology')),
  name text not null check (char_length(name) between 3 and 120),
  price_egp int not null check (price_egp between 1 and 20000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.prescription_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  note text not null check (char_length(note) between 5 and 500),
  status text not null default 'open' check (status in ('open','answered','closed')),
  expires_at timestamptz not null default now() + interval '3 days',
  created_at timestamptz not null default now()
);
create table if not exists public.prescription_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.prescription_requests(id) on delete cascade,
  pharmacy_id uuid not null references public.providers(id),
  price_egp int not null check (price_egp between 1 and 20000),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (request_id, pharmacy_id)
);
alter table public.lab_tests enable row level security;
alter table public.prescription_requests enable row level security;
alter table public.prescription_quotes enable row level security;
create or replace function public.is_pharmacy() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.providers p where p.user_id=(select auth.uid()) and p.kind='merchant' and p.specialty='pharmacy' and p.approved and p.active and not p.is_test) $$;
create policy lab_tests_read on public.lab_tests for select to authenticated using (
  (active and exists(select 1 from public.providers p where p.id=provider_id and p.kind='merchant' and p.specialty in ('lab','radiology') and p.approved and p.active and not p.is_test))
  or exists(select 1 from public.providers p where p.id=provider_id and p.user_id=(select auth.uid())) or public.is_staff());
create policy rx_read on public.prescription_requests for select to authenticated using (
  customer_id=(select auth.uid()) or public.is_staff() or (status='open' and expires_at > now() and public.is_pharmacy()));
create or replace function public.is_rx_owner(p_req uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.prescription_requests r where r.id=p_req and r.customer_id=(select auth.uid())) $$;
revoke all on function public.is_rx_owner(uuid) from public, anon;
grant execute on function public.is_rx_owner(uuid) to authenticated;
create policy rxq_read on public.prescription_quotes for select to authenticated using (
  public.is_staff()
  or exists(select 1 from public.providers p where p.id=pharmacy_id and p.user_id=(select auth.uid()))
  or public.is_rx_owner(request_id));
-- The requester id is not readable through the API by anyone: pharmacies see the note and status only.
revoke all on public.prescription_requests from authenticated;
grant select (id, note, status, expires_at, created_at) on public.prescription_requests to authenticated;
grant select on public.lab_tests, public.prescription_quotes to authenticated;

create or replace function public.provider_upsert_lab_test(p_name text, p_kind text, p_price int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_p uuid; v_id uuid;
begin
  select id into v_p from public.providers where user_id=(select auth.uid()) and kind='merchant' and specialty=p_kind and approved and active and not is_test;
  if v_p is null or p_kind not in ('lab','radiology') then raise exception 'الحساب ده مش معمل أو مركز أشعة معتمد' using errcode='42501'; end if;
  select id into v_id from public.lab_tests where provider_id=v_p and kind=p_kind and lower(name)=lower(trim(p_name));
  if v_id is null then
    insert into public.lab_tests(provider_id,kind,name,price_egp) values (v_p,p_kind,trim(p_name),p_price) returning id into v_id;
  else update public.lab_tests set price_egp=p_price, active=true where id=v_id; end if;
  return v_id;
end $$;
create or replace function public.provider_set_lab_test_active(p_test uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.lab_tests t set active=p_active where t.id=p_test
    and exists(select 1 from public.providers p where p.id=t.provider_id and p.user_id=(select auth.uid()) and p.kind='merchant' and p.specialty in ('lab','radiology') and p.approved and p.active);
  if not found then raise exception 'لا يمكن تعديل التحليل' using errcode='42501'; end if;
end $$;
create or replace function public.submit_prescription_request(p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_open int; v_recent int;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول' using errcode='42501'; end if;
  if not ( exists(select 1 from public.consents where user_id=v_uid and kind='terms') and exists(select 1 from public.consents where user_id=v_uid and kind='privacy') ) then
    raise exception 'لازم توافق على الشروط وسياسة الخصوصية الأول' using errcode='42501'; end if;
  if p_note is null or char_length(trim(p_note)) < 5 then raise exception 'اكتب أسماء الأدوية' using errcode='22023'; end if;
  select count(*) into v_open from public.prescription_requests where customer_id=v_uid and status<>'closed' and expires_at > now();
  if v_open >= 3 then raise exception 'عندك 3 طلبات مفتوحة بالفعل' using errcode='53400'; end if;
  insert into public.prescription_requests(customer_id,note) values (v_uid, trim(p_note)) returning id into v_id;
  return v_id;
end $$;
create or replace function public.pharmacy_quote_request(p_request uuid, p_price int, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_p uuid; v_id uuid; v_r public.prescription_requests%rowtype;
begin
  select id into v_p from public.providers where user_id=(select auth.uid()) and kind='merchant' and specialty='pharmacy' and approved and active and not is_test;
  if v_p is null then raise exception 'الحساب ده مش صيدلية معتمدة' using errcode='42501'; end if;
  select * into v_r from public.prescription_requests where id=p_request for update;
  if not found or v_r.status='closed' or v_r.expires_at <= now() then raise exception 'الطلب مش متاح' using errcode='22023'; end if;
  if v_r.customer_id = (select auth.uid()) then raise exception 'لا يمكن الرد على طلبك' using errcode='42501'; end if;
  if p_price is null or p_price < 1 or p_price > 20000 then raise exception 'السعر غير صالح' using errcode='22023'; end if;
  insert into public.prescription_quotes(request_id,pharmacy_id,price_egp,note) values (p_request, v_p, p_price, nullif(trim(coalesce(p_note,'')),''))
    on conflict (request_id,pharmacy_id) do update set price_egp=excluded.price_egp, note=excluded.note returning id into v_id;
  update public.prescription_requests set status='answered' where id=p_request and status='open';
  return v_id;
end $$;
create or replace function public.customer_close_prescription_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.prescription_requests set status='closed' where id=p_request and customer_id=(select auth.uid()) and status<>'closed';
  if not found then raise exception 'لا يمكن إغلاق الطلب' using errcode='42501'; end if;
end $$;
revoke all on function public.provider_upsert_lab_test(text,text,int), public.provider_set_lab_test_active(uuid,boolean), public.submit_prescription_request(text),
  public.pharmacy_quote_request(uuid,int,text), public.customer_close_prescription_request(uuid), public.is_pharmacy() from public, anon;
grant execute on function public.provider_upsert_lab_test(text,text,int), public.provider_set_lab_test_active(uuid,boolean), public.submit_prescription_request(text),
  public.pharmacy_quote_request(uuid,int,text), public.customer_close_prescription_request(uuid), public.is_pharmacy() to authenticated;
