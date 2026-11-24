-- wasla-test ONLY draft. Requires 0500. Adds a private prescription image/PDF upload and a delivery answer on quotes. SYNTHETIC files only.
-- Sharing model: the file lives in the PRIVATE bucket 'prescriptions' (no public URL, signed URLs only, 5 MB, jpeg/png/webp/pdf).
-- Readable by: the requester, staff, and approved+active pharmacies while the request is open or answered and not expired,
-- and a pharmacy that already quoted it until the request is closed or expires. Closed/expired requests lose pharmacy access.
-- Known gaps: any approved pharmacy sees every open request (no choice of audience); the file content itself can identify the patient; no antivirus scan; no retention job deletes expired files.
alter table public.prescription_requests add column if not exists attachment_path text check (attachment_path is null or attachment_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
alter table public.prescription_quotes add column if not exists delivery_available boolean not null default false;
alter table public.prescription_quotes add column if not exists eta_minutes int check (eta_minutes is null or eta_minutes between 5 and 2880);
create or replace function public.rx_pharmacy_can_see(p_req uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_pharmacy() and exists(select 1 from public.prescription_requests r where r.id=p_req and r.status<>'closed' and r.expires_at > now()
    and (r.status in ('open','answered') or exists(select 1 from public.prescription_quotes q join public.providers p on p.id=q.pharmacy_id where q.request_id=r.id and p.user_id=(select auth.uid())))) $$;
revoke all on function public.rx_pharmacy_can_see(uuid) from public, anon;
grant execute on function public.rx_pharmacy_can_see(uuid) to authenticated;
alter policy rx_read on public.prescription_requests using (customer_id=(select auth.uid()) or public.is_staff() or (status<>'closed' and expires_at > now() and public.is_pharmacy()));
grant select (attachment_path) on public.prescription_requests to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('prescriptions','prescriptions',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.rx_path_owner(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.prescription_requests r where r.id::text=split_part(p_name,'/',1) and r.customer_id=(select auth.uid()) and r.status<>'closed') $$;
create or replace function public.rx_path_readable(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.prescription_requests r where r.id::text=split_part(p_name,'/',1) and (r.customer_id=(select auth.uid()) or public.is_staff() or public.rx_pharmacy_can_see(r.id))) $$;
revoke all on function public.rx_path_owner(text), public.rx_path_readable(text) from public, anon;
grant execute on function public.rx_path_owner(text), public.rx_path_readable(text) to authenticated;
create policy rx_files_insert on storage.objects for insert to authenticated with check (bucket_id='prescriptions' and public.rx_path_owner(name));
create policy rx_files_read on storage.objects for select to authenticated using (bucket_id='prescriptions' and public.rx_path_readable(name));
create policy rx_files_delete on storage.objects for delete to authenticated using (bucket_id='prescriptions' and public.rx_path_owner(name));
create or replace function public.attach_prescription_file(p_request uuid, p_path text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_path is null or split_part(p_path,'/',1) <> p_request::text then raise exception 'مسار الملف غير صالح' using errcode='22023'; end if;
  update public.prescription_requests set attachment_path=p_path where id=p_request and customer_id=(select auth.uid()) and status<>'closed'
    and exists(select 1 from storage.objects o where o.bucket_id='prescriptions' and o.name=p_path);
  if not found then raise exception 'لا يمكن إرفاق الملف' using errcode='42501'; end if;
end $$;
alter function public.pharmacy_quote_request(uuid,int,text) rename to pharmacy_quote_request_v1;
revoke all on function public.pharmacy_quote_request_v1(uuid,int,text) from authenticated;
create or replace function public.pharmacy_quote_request(p_request uuid, p_price int, p_note text default null, p_delivery boolean default false, p_eta int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_p uuid; v_id uuid; v_r public.prescription_requests%rowtype;
begin
  select id into v_p from public.providers where user_id=(select auth.uid()) and kind='merchant' and specialty='pharmacy' and approved and active and not is_test;
  if v_p is null then raise exception 'الحساب ده مش صيدلية معتمدة' using errcode='42501'; end if;
  select * into v_r from public.prescription_requests where id=p_request for update;
  if not found or v_r.status='closed' or v_r.expires_at <= now() then raise exception 'الطلب مش متاح' using errcode='22023'; end if;
  if v_r.customer_id = (select auth.uid()) then raise exception 'لا يمكن الرد على طلبك' using errcode='42501'; end if;
  if p_price is null or p_price < 1 or p_price > 20000 then raise exception 'السعر غير صالح' using errcode='22023'; end if;
  if p_eta is not null and (p_eta < 5 or p_eta > 2880) then raise exception 'مدة التوصيل غير صالحة' using errcode='22023'; end if;
  insert into public.prescription_quotes(request_id,pharmacy_id,price_egp,note,delivery_available,eta_minutes) values (p_request, v_p, p_price, nullif(trim(coalesce(p_note,'')),''), coalesce(p_delivery,false), p_eta)
    on conflict (request_id,pharmacy_id) do update set price_egp=excluded.price_egp, note=excluded.note, delivery_available=excluded.delivery_available, eta_minutes=excluded.eta_minutes returning id into v_id;
  update public.prescription_requests set status='answered' where id=p_request and status='open';
  return v_id;
end $$;
revoke all on function public.pharmacy_quote_request(uuid,int,text,boolean,int), public.attach_prescription_file(uuid,text) from public, anon;
grant execute on function public.pharmacy_quote_request(uuid,int,text,boolean,int), public.attach_prescription_file(uuid,text) to authenticated;
