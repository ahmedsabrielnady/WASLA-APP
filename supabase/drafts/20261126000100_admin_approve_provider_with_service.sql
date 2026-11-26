-- wasla-test ONLY. Draft, not a production migration.
-- Founder flow: choose section, then specialty, enter provider name and service price, approve, in one call.
-- Admin only (role = 'admin'). Reuses the audited price function and the coverage function (which keep their own kind and specialty checks).
create or replace function public.admin_approve_provider_with_service(
  p_provider uuid, p_sector text, p_specialty text, p_display_name text, p_price integer)
returns table(out_provider_id uuid, out_service_item_id integer, out_price_egp integer, out_public_orderable boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_provider public.providers%rowtype;
  v_item_id integer;
  v_name text := trim(coalesce(p_display_name, ''));
  v_spec text := trim(coalesce(p_specialty, ''));
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501';
  end if;
  if p_sector is null or p_sector not in ('clinic','maintenance','car','education','delivery','food') then
    raise exception 'القسم غير مدعوم في الاعتماد' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'اسم مقدم الخدمة من 2 إلى 60 حرفًا' using errcode = '22023'; end if;
  if char_length(v_spec) not between 2 and 60 then raise exception 'التخصص من 2 إلى 60 حرفًا' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then raise exception 'السعر غير صالح' using errcode = '22023'; end if;
  select * into v_provider from public.providers where id = p_provider for update;
  if not found then raise exception 'مقدم الخدمة غير موجود' using errcode = 'P0002'; end if;
  if v_provider.is_test then raise exception 'حساب تجريبي لا يُعتمد كمقدم خدمة حقيقي' using errcode = '42501'; end if;
  if not ((p_sector in ('maintenance','car') and v_provider.kind = 'technician')
       or (p_sector = 'clinic' and v_provider.kind = 'doctor')
       or (p_sector = 'education' and v_provider.kind = 'teacher')
       or (p_sector = 'delivery' and v_provider.kind = 'courier')
       or (p_sector = 'food' and v_provider.kind in ('merchant','courier'))) then
    raise exception 'نوع مقدم الخدمة غير مناسب لهذا القسم' using errcode = '22023';
  end if;
  update public.providers set display_name = v_name, specialty = v_spec, approved = true, active = true where id = p_provider;
  insert into public.service_items(sector, name, price_egp, active) values (p_sector, v_spec, null, true)
    on conflict (sector, name) do update set active = true
    returning id into v_item_id;
  perform public.admin_update_service_item_price(v_item_id, p_price);
  perform public.admin_set_provider_service_coverage(p_provider, v_item_id, true);
  return query select p_provider, v_item_id, p_price, si.public_orderable from public.service_items si where si.id = v_item_id;
end $$;
revoke execute on function public.admin_approve_provider_with_service(uuid,text,text,text,integer) from public, anon;
grant execute on function public.admin_approve_provider_with_service(uuid,text,text,text,integer) to authenticated;
