-- wasla-test ONLY. Draft: bulk product import with dry-run validation, aisles, search indexes. Not a production migration.
create extension if not exists pg_trgm with schema extensions;
alter table public.products add column if not exists unit text, add column if not exists barcode text, add column if not exists image_url text, add column if not exists aisle text;
alter table public.products drop constraint if exists products_extra_check;
alter table public.products add constraint products_extra_check check (
  (unit is null or char_length(unit) <= 30) and (barcode is null or barcode ~ '^[0-9A-Za-z\-]{3,32}$')
  and (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://')) and (aisle is null or char_length(aisle) <= 30)) not valid;
create unique index if not exists products_merchant_barcode_uq on public.products (merchant_id, barcode) where barcode is not null;
create index if not exists products_merchant_name_idx on public.products (merchant_id, lower(btrim(name)));
create index if not exists products_browse_idx on public.products (category, aisle, id) where active and stock > 0;
create index if not exists products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

create or replace function public.product_aisle_code(p text) returns text language sql immutable set search_path = '' as $$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p,'')))
    when 'dairy' then 'dairy' when 'ألبان' then 'dairy' when 'ألبان وأجبان' then 'dairy'
    when 'grains' then 'grains' when 'أرز ومكرونة' then 'grains' when 'حبوب' then 'grains' when 'بقوليات' then 'grains'
    when 'oils' then 'oils' when 'زيوت وسمن' then 'oils'
    when 'canned' then 'canned' when 'معلبات' then 'canned'
    when 'drinks' then 'drinks' when 'مشروبات' then 'drinks'
    when 'snacks' then 'snacks' when 'سناكس وحلويات' then 'snacks'
    when 'produce' then 'produce' when 'خضار وفاكهة' then 'produce'
    when 'meat' then 'meat' when 'لحوم ودواجن' then 'meat'
    when 'bakery' then 'bakery' when 'مخبوزات' then 'bakery'
    when 'coffee' then 'coffee' when 'بن وشاي' then 'coffee'
    when 'cleaning' then 'cleaning' when 'منظفات' then 'cleaning'
    when 'personal' then 'personal' when 'عناية شخصية' then 'personal'
    when 'household' then 'household' when 'أدوات منزلية' then 'household'
    when 'baby' then 'baby' when 'مستلزمات أطفال' then 'baby'
    when 'other' then 'other' when 'أخرى' then 'other' when '' then 'other'
    else null end $$;

create or replace function public._import_products(p_merchant uuid, p_rows jsonb, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_name text; v_aisle text; v_cat text; v_price numeric; v_stock numeric; v_unit text; v_bc text; v_img text;
  v_exist record; v_msg text; v_warn text; v_status text; v_seen text[] := '{}'; v_key text;
  v_out jsonb := '[]'::jsonb; v_new int := 0; v_upd int := 0; v_err int := 0; v_wrn int := 0; v_total int; v_have int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'الملف فاضي أو غير صالح' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 or v_total > 2000 then raise exception 'عدد الصفوف لازم يكون من 1 إلى 2000 في المرة' using errcode = '22023'; end if;
  select count(*) into v_have from public.products where merchant_id = p_merchant;
  for r in select e.value as j, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e loop
    v_msg := null; v_warn := null; v_status := null;
    v_name := pg_catalog.btrim(coalesce(r.j->>'name',''));
    v_bc := nullif(pg_catalog.btrim(coalesce(r.j->>'barcode','')),'');
    v_unit := nullif(pg_catalog.btrim(coalesce(r.j->>'unit','')),'');
    v_img := nullif(pg_catalog.btrim(coalesce(r.j->>'image_url','')),'');
    v_aisle := public.product_aisle_code(r.j->>'aisle');
    v_cat := case pg_catalog.lower(pg_catalog.btrim(coalesce(r.j->>'category','market')))
      when 'market' then 'market' when 'ماركت' then 'market' when '' then 'market'
      when 'supplies' then 'supplies' when 'مستلزمات طبية' then 'supplies' else null end;
    begin v_price := nullif(pg_catalog.btrim(coalesce(r.j->>'price','')),'')::numeric; exception when others then v_price := null; v_msg := 'السعر مش رقم'; end;
    begin v_stock := nullif(pg_catalog.btrim(coalesce(r.j->>'stock','')),'')::numeric; exception when others then v_stock := null; v_msg := coalesce(v_msg,'المخزون مش رقم'); end;
    if v_msg is null then
      if char_length(v_name) < 2 or char_length(v_name) > 120 then v_msg := 'الاسم من 2 إلى 120 حرف';
      elsif v_cat is null then v_msg := 'التصنيف لازم ماركت أو مستلزمات طبية';
      elsif v_aisle is null then v_msg := 'القسم غير معروف (استخدم قسم من القائمة)';
      elsif v_price is null or v_price < 1 or v_price > 100000 then v_msg := 'السعر من 1 إلى 100000 جنيه';
      elsif v_price <> trunc(v_price) then v_msg := 'السعر لازم جنيه صحيح (النظام الحالي لا يدعم القروش)';
      elsif v_stock is null or v_stock < 0 or v_stock > 10000 or v_stock <> trunc(v_stock) then v_msg := 'المخزون عدد صحيح من 0 إلى 10000';
      elsif v_bc is not null and v_bc !~ '^[0-9A-Za-z\-]{3,32}$' then v_msg := 'الباركود غير صالح (3 إلى 32 حرف أو رقم)';
      elsif v_img is not null and (v_img !~ '^https://' or char_length(v_img) > 500) then v_msg := 'رابط الصورة لازم يبدأ بـ https';
      elsif v_unit is not null and char_length(v_unit) > 30 then v_msg := 'الوحدة طويلة';
      end if;
    end if;
    if v_msg is null then
      v_key := coalesce('b:'||v_bc, 'n:'||pg_catalog.lower(v_name));
      if v_key = any(v_seen) then v_msg := 'مكرر داخل الملف (نفس الباركود أو الاسم)'; else v_seen := v_seen || v_key; end if;
    end if;
    if v_msg is null then
      select id, price_egp into v_exist from public.products
       where merchant_id = p_merchant and ((v_bc is not null and barcode = v_bc) or (v_bc is null and pg_catalog.lower(pg_catalog.btrim(name)) = pg_catalog.lower(v_name))) limit 1;
      if found then
        v_status := 'update';
        if v_exist.price_egp > 0 and abs(v_price - v_exist.price_egp) / v_exist.price_egp > 0.5 then v_warn := 'السعر اتغير أكتر من 50% (كان ' || v_exist.price_egp || ')'; end if;
        if p_commit then update public.products set name = v_name, price_egp = v_price, stock = v_stock, category = v_cat, aisle = v_aisle, unit = v_unit, image_url = coalesce(v_img, image_url), barcode = coalesce(v_bc, barcode), active = true where id = v_exist.id; end if;
        v_upd := v_upd + 1;
      else
        v_status := 'new'; v_have := v_have + 1;
        if v_have > 10000 then v_msg := 'تعدى الحد الأقصى 10000 منتج للتاجر'; v_have := v_have - 1; v_status := null;
        else
          if v_price > 5000 then v_warn := 'سعر مرتفع، راجعه'; end if;
          if p_commit then insert into public.products (merchant_id, name, price_egp, stock, active, category, aisle, unit, barcode, image_url) values (p_merchant, v_name, v_price, v_stock, true, v_cat, v_aisle, v_unit, v_bc, v_img); end if;
          v_new := v_new + 1;
        end if;
      end if;
    end if;
    if v_msg is not null then v_err := v_err + 1; v_status := 'error'; end if;
    if v_warn is not null then v_wrn := v_wrn + 1; end if;
    if v_status = 'error' or v_warn is not null then v_out := v_out || jsonb_build_object('n', r.n, 'status', v_status, 'msg', coalesce(v_msg, v_warn)); end if;
  end loop;
  if p_commit and v_err > 0 then raise exception 'في % صف فيه أخطاء، صلحها الأول', v_err using errcode = '22023'; end if;
  return jsonb_build_object('total', v_total, 'new', v_new, 'update', v_upd, 'errors', v_err, 'warnings', v_wrn, 'committed', p_commit, 'rows', v_out);
end $$;
revoke all on function public._import_products(uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.merchant_import_products(p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'سجل دخولك الأول' using errcode = '28000'; end if;
  select p.id into v_pid from public.providers p join public.profiles pr on pr.id = p.user_id
   where p.user_id = auth.uid() and p.kind = 'merchant' and p.approved and p.active and not p.is_test and pr.role = 'merchant' limit 1;
  if v_pid is null then raise exception 'حساب التاجر غير معتمد' using errcode = '42501'; end if;
  return public._import_products(v_pid, p_rows, coalesce(p_commit, false));
end $$;
revoke all on function public.merchant_import_products(jsonb, boolean) from public, anon;
grant execute on function public.merchant_import_products(jsonb, boolean) to authenticated;

create or replace function public.staff_import_products(p_merchant uuid, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'للموظفين فقط' using errcode = '42501'; end if;
  if not exists (select 1 from public.providers where id = p_merchant and kind = 'merchant') then raise exception 'التاجر غير موجود' using errcode = '22023'; end if;
  return public._import_products(p_merchant, p_rows, coalesce(p_commit, false));
end $$;
revoke all on function public.staff_import_products(uuid, jsonb, boolean) from public, anon;
grant execute on function public.staff_import_products(uuid, jsonb, boolean) to authenticated;

-- raise the per-merchant cap from 200 to 10000 in the single-add RPC (same cap as the import)
do $$ declare d text; begin
  select pg_get_functiondef('public.merchant_add_product(text,text,integer,integer)'::regprocedure) into d;
  d := replace(d, '>= 200 then', '>= 10000 then');
  execute d;
end $$;
