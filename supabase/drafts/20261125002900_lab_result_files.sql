-- wasla-test ONLY draft (not a production migration). SYNTHETIC files only: never store real results. Requires 2600 (lab_requests).
-- Lab/radiology result FILES (pdf, jpeg, png, up to 5 MB) in the PRIVATE bucket 'lab-results' (no public URL, signed URLs only).
-- Upload: only the owning approved lab, only while the request is 'sample_done'. Delete: same lab, only before publishing. A published file is immutable.
-- Read: the patient and the owning lab ONLY. Staff have no storage read policy here (the direct staff read of rx files is an open release gate; this bucket avoids it).
-- Open gates, same as the prescriptions bucket: CDN cache and revocation of signed URLs, no malware scan, no retention job, the file content itself can identify the patient.
alter table public.lab_requests add column if not exists result_file_path text
  check (result_file_path is null or result_file_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.lab_requests'::regclass and contype='c'
    and pg_get_constraintdef(oid) ilike '%result_ready%' and pg_get_constraintdef(oid) ilike '%result_text IS NOT NULL%' loop
    execute format('alter table public.lab_requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.lab_requests drop constraint if exists lab_requests_result_present;
alter table public.lab_requests add constraint lab_requests_result_present
  check ((status = 'result_ready') = (result_text is not null or result_file_path is not null));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('lab-results','lab-results',false,5242880,array['application/pdf','image/jpeg','image/png'])
  on conflict (id) do update set public=false, file_size_limit=5242880, allowed_mime_types=array['application/pdf','image/jpeg','image/png'];
create or replace function public.lab_path_upload_ok(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.lab_requests r join public.providers p on p.id = r.provider_id
    where r.id::text = split_part(p_name,'/',1) and r.status = 'sample_done' and p.user_id = (select auth.uid()) and p.approved and p.active
      and p.kind = 'merchant' and p.specialty in ('lab','radiology')) $$;
create or replace function public.lab_path_readable(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.lab_requests r where r.id::text = split_part(p_name,'/',1)
    and ((r.status = 'result_ready' and r.result_file_path = p_name
          and (r.patient_id = (select auth.uid()) or exists(select 1 from public.providers p where p.id = r.provider_id and p.user_id = (select auth.uid()))))
      -- the owning lab sees its own unpublished upload (storage needs select access to delete it); the patient never does
      or (r.status = 'sample_done' and exists(select 1 from public.providers p where p.id = r.provider_id and p.user_id = (select auth.uid()))))) $$;
revoke all on function public.lab_path_upload_ok(text), public.lab_path_readable(text) from public, anon;
grant execute on function public.lab_path_upload_ok(text), public.lab_path_readable(text) to authenticated;
drop policy if exists lab_files_insert on storage.objects;
drop policy if exists lab_files_read on storage.objects;
drop policy if exists lab_files_delete on storage.objects;
create policy lab_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'lab-results' and public.lab_path_upload_ok(name));
create policy lab_files_read on storage.objects for select to authenticated using (bucket_id = 'lab-results' and public.lab_path_readable(name));
create policy lab_files_delete on storage.objects for delete to authenticated using (bucket_id = 'lab-results' and public.lab_path_upload_ok(name));
create or replace function public.lab_publish_result_file(p_request uuid, p_path text, p_text text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n text := nullif(trim(coalesce(p_text,'')),'');
begin
  if p_path is null or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' or split_part(p_path,'/',1) <> p_request::text then
    raise exception 'مسار الملف غير صالح' using errcode='22023'; end if;
  if v_n is not null and char_length(v_n) not between 3 and 2000 then raise exception 'نص النتيجة غير صالح' using errcode='22023'; end if;
  update public.lab_requests r set status = 'result_ready', result_file_path = p_path, result_text = v_n, updated_at = now()
    where r.id = p_request and r.status = 'sample_done'
      and exists(select 1 from public.providers p where p.id = r.provider_id and p.user_id = (select auth.uid()) and p.approved and p.active
        and p.kind = 'merchant' and p.specialty in ('lab','radiology'))
      and exists(select 1 from storage.objects o where o.bucket_id = 'lab-results' and o.name = p_path);
  if not found then raise exception 'مينفعش تنشر النتيجة دي' using errcode='42501'; end if;
end $$;
revoke all on function public.lab_publish_result_file(uuid,text,text) from public, anon;
grant execute on function public.lab_publish_result_file(uuid,text,text) to authenticated;
