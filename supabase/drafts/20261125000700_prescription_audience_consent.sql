-- wasla-test ONLY draft. Requires 0500 and 0600. RELEASE GATE work: replaces "every approved pharmacy sees every open request" with an explicit audience chosen by the patient.
-- Sharing model now: a request is invisible to all pharmacies until the owner calls rx_set_audience(request, pharmacy ids (1-5), consent=true).
-- Only the selected approved+active pharmacies can read the row and file or quote. Calling it with an empty list withdraws consent and removes access at once (database and storage policies).
-- Signed URLs already issued stay valid until their own expiry (see health_rx_audience_test.py: measured). Staff can still read (support/abuse handling): there is NO access audit log yet. No malware scan. Retention: owner can delete files through the storage API; there is no scheduled expiry deletion (needs a service-role job).
alter table public.prescription_requests add column if not exists consent_at timestamptz;
grant select (consent_at) on public.prescription_requests to authenticated;
create table if not exists public.prescription_audience (
  request_id uuid not null references public.prescription_requests(id) on delete cascade,
  pharmacy_id uuid not null references public.providers(id),
  created_at timestamptz not null default now(),
  primary key (request_id, pharmacy_id));
alter table public.prescription_audience enable row level security;
revoke all on public.prescription_audience from anon, authenticated;
create or replace function public.rx_pharmacy_can_see(p_req uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.prescription_requests r
    join public.prescription_audience a on a.request_id=r.id
    join public.providers p on p.id=a.pharmacy_id
    where r.id=p_req and r.status<>'closed' and r.expires_at > now() and r.consent_at is not null
      and p.user_id=(select auth.uid()) and p.kind='merchant' and p.specialty='pharmacy' and p.approved and p.active and not p.is_test) $$;
alter policy rx_read on public.prescription_requests using (customer_id=(select auth.uid()) or public.is_staff() or public.rx_pharmacy_can_see(id));
create or replace function public.list_pharmacies() returns table(id uuid, display_name text, area text) language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.area from public.providers p where p.kind='merchant' and p.specialty='pharmacy' and p.approved and p.active and not p.is_test and (select auth.uid()) is not null order by p.display_name $$;
create or replace function public.rx_set_audience(p_request uuid, p_pharmacies uuid[], p_consent boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform 1 from public.prescription_requests where id=p_request and customer_id=(select auth.uid()) and status<>'closed' for update;
  if not found then raise exception 'الطلب مش متاح' using errcode='42501'; end if;
  delete from public.prescription_audience where request_id=p_request;
  if p_pharmacies is null or cardinality(p_pharmacies)=0 then
    update public.prescription_requests set consent_at=null where id=p_request; return; end if;
  if p_consent is not true then raise exception 'لازم توافق على مشاركة الروشتة مع الصيدليات المختارة' using errcode='22023'; end if;
  if cardinality(p_pharmacies) > 5 then raise exception 'اختار 5 صيدليات على الأكثر' using errcode='22023'; end if;
  insert into public.prescription_audience(request_id,pharmacy_id)
    select p_request, p.id from public.providers p where p.id = any(p_pharmacies) and p.kind='merchant' and p.specialty='pharmacy' and p.approved and p.active and not p.is_test;
  get diagnostics v_n = row_count;
  if v_n <> (select count(distinct x) from unnest(p_pharmacies) x) then raise exception 'صيدلية غير متاحة' using errcode='22023'; end if;
  update public.prescription_requests set consent_at=now() where id=p_request;
end $$;
create or replace function public.rx_path_owner_any(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.prescription_requests r where r.id::text=split_part(p_name,'/',1) and r.customer_id=(select auth.uid())) $$;
alter policy rx_files_delete on storage.objects using (bucket_id='prescriptions' and public.rx_path_owner_any(name));
create or replace function public.pharmacy_quote_request(p_request uuid, p_price int, p_note text default null, p_delivery boolean default false, p_eta int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_p uuid; v_id uuid; v_r public.prescription_requests%rowtype;
begin
  select id into v_p from public.providers where user_id=(select auth.uid()) and kind='merchant' and specialty='pharmacy' and approved and active and not is_test;
  if v_p is null then raise exception 'الحساب ده مش صيدلية معتمدة' using errcode='42501'; end if;
  select * into v_r from public.prescription_requests where id=p_request for update;
  if not found or v_r.status='closed' or v_r.expires_at <= now() or not public.rx_pharmacy_can_see(p_request) then raise exception 'الطلب مش متاح' using errcode='22023'; end if;
  if v_r.customer_id = (select auth.uid()) then raise exception 'لا يمكن الرد على طلبك' using errcode='42501'; end if;
  if p_price is null or p_price < 1 or p_price > 20000 then raise exception 'السعر غير صالح' using errcode='22023'; end if;
  if p_eta is not null and (p_eta < 5 or p_eta > 2880) then raise exception 'مدة التوصيل غير صالحة' using errcode='22023'; end if;
  insert into public.prescription_quotes(request_id,pharmacy_id,price_egp,note,delivery_available,eta_minutes) values (p_request, v_p, p_price, nullif(trim(coalesce(p_note,'')),''), coalesce(p_delivery,false), p_eta)
    on conflict (request_id,pharmacy_id) do update set price_egp=excluded.price_egp, note=excluded.note, delivery_available=excluded.delivery_available, eta_minutes=excluded.eta_minutes returning id into v_id;
  update public.prescription_requests set status='answered' where id=p_request and status='open';
  return v_id;
end $$;
revoke all on function public.list_pharmacies(), public.rx_set_audience(uuid,uuid[],boolean), public.rx_path_owner_any(text) from public, anon;
grant execute on function public.list_pharmacies(), public.rx_set_audience(uuid,uuid[],boolean), public.rx_path_owner_any(text) to authenticated;
