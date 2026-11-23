-- WASLA live database patch archive
-- Applied to the connected Supabase project "wasla" as migration:
-- 20261119225555_harden_invite_role_allowlist
--
-- This file records the exact patch for source control and review.
-- It is NOT a standalone baseline migration for a new database.
-- The preceding 12 live migrations have not yet been fully reconstructed
-- in this repository. Do not apply this patch to an empty database by itself.

create or replace function public.create_invite(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_code text;
  v_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_kind, '')));
begin
  if auth.uid() is null then
    raise exception 'سجل دخولك الأول' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'مسموح للموظفين المخولين فقط' using errcode = '42501';
  end if;

  if v_kind not in ('doctor', 'merchant', 'teacher', 'courier', 'technician', 'staff') then
    raise exception 'نوع الدعوة غير مسموح' using errcode = '22023';
  end if;

  if v_kind = 'staff' and public.current_role_name() is distinct from 'admin' then
    raise exception 'إضافة موظف تحتاج صلاحية مدير النظام' using errcode = '42501';
  end if;

  insert into public.invites (kind, created_by)
  values (v_kind, auth.uid())
  returning code into v_code;

  return v_code;
end;
$function$;

create or replace function public.redeem_invite(
  p_code text,
  p_display_name text,
  p_specialty text default null,
  p_area text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.invites%rowtype;
  v_uid uuid := auth.uid();
  v_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  v_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then
    raise exception 'سجل دخولك الأول' using errcode = '28000';
  end if;

  if v_code = '' then
    raise exception 'كود الدعوة مطلوب' using errcode = '22023';
  end if;

  select *
    into v_inv
    from public.invites
   where code = v_code
   for update;

  if not found or v_inv.used_at is not null or v_inv.expires_at < pg_catalog.now() then
    raise exception 'الكود غلط أو منتهي' using errcode = '22023';
  end if;

  if v_inv.kind not in ('doctor', 'merchant', 'teacher', 'courier', 'technician', 'staff') then
    raise exception 'نوع الدعوة غير مسموح' using errcode = '22023';
  end if;

  if v_inv.kind = 'staff' then
    if not exists (
      select 1
        from public.profiles inviter
       where inviter.id = v_inv.created_by
         and inviter.role = 'admin'
    ) then
      raise exception 'دعوة الموظف غير صادرة من مدير النظام' using errcode = '42501';
    end if;

    update public.profiles
       set role = 'staff'
     where id = v_uid;

    if not found then
      raise exception 'ملف الحساب غير موجود' using errcode = 'P0002';
    end if;
  else
    if v_display_name = '' or pg_catalog.char_length(v_display_name) > 100 then
      raise exception 'الاسم مطلوب وبحد أقصى 100 حرف' using errcode = '22023';
    end if;

    insert into public.providers (user_id, kind, display_name, specialty, area, approved)
    values (
      v_uid,
      v_inv.kind,
      v_display_name,
      nullif(pg_catalog.btrim(coalesce(p_specialty, '')), ''),
      nullif(pg_catalog.btrim(coalesce(p_area, '')), ''),
      false
    );

    update public.profiles
       set role = v_inv.kind
     where id = v_uid;

    if not found then
      raise exception 'ملف الحساب غير موجود' using errcode = 'P0002';
    end if;
  end if;

  update public.invites
     set used_by = v_uid,
         used_at = pg_catalog.now()
   where code = v_inv.code;

  return v_inv.kind;
end;
$function$;

revoke execute on function public.create_invite(text) from public, anon;
grant execute on function public.create_invite(text) to authenticated;

revoke execute on function public.redeem_invite(text, text, text, text) from public, anon;
grant execute on function public.redeem_invite(text, text, text, text) to authenticated;
