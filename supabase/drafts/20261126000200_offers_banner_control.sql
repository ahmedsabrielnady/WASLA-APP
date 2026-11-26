-- wasla-test ONLY. Draft, not a production migration.
-- Founder control of the advertising banner: each offer can point at a section; a tap on the banner opens that section.
alter table public.offers add column if not exists sector text;
alter table public.offers drop constraint if exists offers_sector_check;
alter table public.offers add constraint offers_sector_check
  check (sector is null or sector in ('clinic','nursing','food','market','maintenance','education','car','delivery'));

create or replace function public.admin_save_offer(
  p_id bigint, p_text text, p_sector text, p_active boolean, p_sort integer)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_text text := trim(coalesce(p_text, ''));
  v_id bigint;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception 'هذه العملية مخصصة للمؤسس فقط' using errcode = '42501';
  end if;
  if char_length(v_text) not between 3 and 140 then
    raise exception 'نص العرض من 3 إلى 140 حرفًا' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_sector, '')), '') is not null and trim(p_sector) not in ('clinic','nursing','food','market','maintenance','education','car','delivery') then
    raise exception 'القسم غير صالح' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.offers (text, sector, active, sort_order)
    values (v_text, nullif(trim(coalesce(p_sector, '')), ''), coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into v_id;
  else
    update public.offers set text = v_text, sector = nullif(trim(coalesce(p_sector, '')), ''),
      active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'العرض غير موجود' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.admin_save_offer(bigint, text, text, boolean, integer) from public, anon;
grant execute on function public.admin_save_offer(bigint, text, text, boolean, integer) to authenticated;
