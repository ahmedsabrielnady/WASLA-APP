-- wasla-test ONLY. Draft, not a production migration. Per-doctor clinic fee (replaces the flat price of the first clinic service item).
-- Requires 20261126000100 (admin_approve_provider_with_service). Patches two live functions in place and fails loudly if the expected text is not found.
-- A doctor with no fee cannot be booked: the founder must set it explicitly (no silent default).
alter table public.providers add column if not exists clinic_fee_egp integer;
do $c$ begin
 if not exists (select 1 from pg_constraint where conname = 'providers_clinic_fee_range') then
 alter table public.providers add constraint providers_clinic_fee_range check (clinic_fee_egp is null or clinic_fee_egp between 1 and 100000);
 end if;
end $c$;

create or replace function public.admin_set_clinic_fee(p_provider uuid, p_fee integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_p public.providers%rowtype;
begin
 if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
 raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501'; end if;
 if p_fee is null or p_fee < 1 or p_fee > 100000 then raise exception 'سعر الكشف غير صالح' using errcode = '22023'; end if;
 select * into v_p from public.providers where id = p_provider for update;
 if not found or v_p.kind <> 'doctor' then raise exception 'الطبيب غير موجود' using errcode = 'P0002'; end if;
 if v_p.is_test then raise exception 'حساب تجريبي' using errcode = '42501'; end if;
 update public.providers set clinic_fee_egp = p_fee where id = p_provider;
end $$;
revoke execute on function public.admin_set_clinic_fee(uuid,integer) from public, anon;
grant execute on function public.admin_set_clinic_fee(uuid,integer) to authenticated;

do $p$
declare d text;
begin
 d := pg_get_functiondef('public.book_clinic_slot(uuid,timestamptz,text,text)'::regprocedure);
 if position('v_ref text;' in d) = 0 or position('select * into v_item' in d) = 0 or position('v_item.price_egp,0,v_src,p_at' in d) = 0 or position('return query select v_id,v_ref,v_item.price_egp,p_at;' in d) = 0 then
 raise exception 'book_clinic_slot text changed'; end if;
 d := replace(d, 'v_ref text;', 'v_ref text; v_fee integer;');
 d := replace(d, 'select * into v_item', E'select clinic_fee_egp into v_fee from public.providers where id = p_provider;\n  if v_fee is null then raise exception ''سعر الكشف لسه مش محدد لهذا الطبيب'' using errcode = ''22023''; end if;\n  select * into v_item');
 d := replace(d, 'v_item.price_egp,0,v_src,p_at', 'v_fee,0,v_src,p_at');
 d := replace(d, 'return query select v_id,v_ref,v_item.price_egp,p_at;', 'return query select v_id,v_ref,v_fee,p_at;');
 execute d;
 d := pg_get_functiondef('public.admin_approve_provider_with_service(uuid,text,text,text,integer)'::regprocedure);
 if position('perform public.admin_update_service_item_price(v_item_id, p_price);' in d) = 0 then raise exception 'approval function text changed'; end if;
 d := replace(d, 'perform public.admin_update_service_item_price(v_item_id, p_price);', E'if p_sector = ''clinic'' then update public.providers set clinic_fee_egp = p_price where id = p_provider; else perform public.admin_update_service_item_price(v_item_id, p_price); end if;');
 execute d;
end $p$;
