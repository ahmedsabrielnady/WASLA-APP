-- wasla-test ONLY. Draft, not a production migration.
-- Founder-defined ad slots and manual campaigns. No online payment: paid status is recorded by hand. No prices are seeded.
-- Display rules enforced in the database: only approved campaigns, only inside their dates, only on an active slot. The app labels every one "إعلان".
-- Legal note: health and pharmacy advertising may need review before approval. Keep a written agreement with each advertiser outside the platform.
create table if not exists public.ad_slots (
  id serial primary key,
  name text not null unique check (char_length(name) between 2 and 80),
  location text not null check (location ~ '^[a-z0-9_]{2,40}$'),
  size text not null default 'banner' check (size in ('banner','card','strip')),
  price_egp integer check (price_egp is null or price_egp between 1 and 10000000),
  period_days integer check (period_days is null or period_days between 1 and 366),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  slot_id integer not null references public.ad_slots(id),
  advertiser_name text not null check (char_length(advertiser_name) between 2 and 120),
  advertiser_contact text check (advertiser_contact is null or char_length(advertiser_contact) <= 200),
  title text not null check (char_length(title) between 2 and 80),
  body text check (body is null or char_length(body) <= 200),
  image_url text check (image_url is null or image_url ~ '^https://[^ ]+$' and char_length(image_url) <= 500),
  link_url text check (link_url is null or link_url ~ '^https://[^ ]+$' and char_length(link_url) <= 500),
  starts_on date not null,
  ends_on date not null,
  agreed_price_egp integer check (agreed_price_egp is null or agreed_price_egp >= 0),
  paid_status text not null default 'unpaid' check (paid_status in ('unpaid','paid')),
  paid_at timestamptz,
  status text not null default 'draft' check (status in ('draft','approved','paused','ended')),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists ad_campaigns_slot_idx on public.ad_campaigns(slot_id);
create table if not exists public.ad_daily_stats (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  day date not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  unique_viewers integer not null default 0,
  primary key (campaign_id, day)
);
create table if not exists public.ad_seen (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  day date not null,
  visitor_hash text not null check (char_length(visitor_hash) between 16 and 64),
  primary key (campaign_id, day, visitor_hash)
);
alter table public.ad_slots enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_daily_stats enable row level security;
alter table public.ad_seen enable row level security;
revoke all on public.ad_slots, public.ad_campaigns, public.ad_daily_stats, public.ad_seen from anon, authenticated;
grant select on public.ad_slots, public.ad_campaigns, public.ad_daily_stats to authenticated;
drop policy if exists ad_slots_staff on public.ad_slots; create policy ad_slots_staff on public.ad_slots for select to authenticated using ((select public.is_staff()));
drop policy if exists ad_campaigns_staff on public.ad_campaigns; create policy ad_campaigns_staff on public.ad_campaigns for select to authenticated using ((select public.is_staff()));
drop policy if exists ad_stats_staff on public.ad_daily_stats; create policy ad_stats_staff on public.ad_daily_stats for select to authenticated using ((select public.is_staff()));

create or replace function public.staff_save_ad_slot(p_id integer, p_name text, p_location text, p_size text, p_price integer, p_period integer, p_active boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id integer;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_id is null then insert into public.ad_slots(name, location, size, price_egp, period_days, active) values (btrim(p_name), btrim(p_location), p_size, p_price, p_period, coalesce(p_active,true)) returning id into v_id;
  else update public.ad_slots set name = btrim(p_name), location = btrim(p_location), size = p_size, price_egp = p_price, period_days = p_period, active = coalesce(p_active, active) where id = p_id returning id into v_id; end if;
  if v_id is null then raise exception 'المكان غير موجود' using errcode = 'P0002'; end if;
  return v_id;
end $$;
create or replace function public.staff_save_ad_campaign(p_id uuid, p_slot integer, p_advertiser text, p_contact text, p_title text, p_body text, p_image text, p_link text, p_start date, p_end date, p_price integer, p_status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.ad_campaigns(slot_id, advertiser_name, advertiser_contact, title, body, image_url, link_url, starts_on, ends_on, agreed_price_egp, status)
    values (p_slot, btrim(p_advertiser), nullif(btrim(coalesce(p_contact,'')),''), btrim(p_title), nullif(btrim(coalesce(p_body,'')),''), nullif(btrim(coalesce(p_image,'')),''), nullif(btrim(coalesce(p_link,'')),''), p_start, p_end, p_price, coalesce(p_status,'draft')) returning id into v_id;
  else
    update public.ad_campaigns set slot_id = p_slot, advertiser_name = btrim(p_advertiser), advertiser_contact = nullif(btrim(coalesce(p_contact,'')),''), title = btrim(p_title), body = nullif(btrim(coalesce(p_body,'')),''), image_url = nullif(btrim(coalesce(p_image,'')),''), link_url = nullif(btrim(coalesce(p_link,'')),''), starts_on = p_start, ends_on = p_end, agreed_price_egp = p_price, status = coalesce(p_status, status) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'الحملة غير موجودة' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.staff_set_ad_paid(p_id uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  update public.ad_campaigns set paid_status = case when p_paid then 'paid' else 'unpaid' end, paid_at = case when p_paid then now() else null end where id = p_id;
end $$;
-- display: active slot, approved campaign, inside dates (Cairo time). No contact or price returned.
create or replace function public.ads_for_location(p_location text)
returns table(campaign_id uuid, title text, body text, image_url text, link_url text, size text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.body, c.image_url, c.link_url, s.size
  from public.ad_campaigns c join public.ad_slots s on s.id = c.slot_id
  where s.location = p_location and s.active and c.status = 'approved'
    and (now() at time zone 'Africa/Cairo')::date between c.starts_on and c.ends_on
  order by c.created_at desc limit 3;
$$;
-- tracking: counts only, hashed visitor id supplied by the app (no identity stored). Only counts campaigns that are currently displayable.
create or replace function public.ad_track(p_campaign uuid, p_kind text, p_visitor text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'Africa/Cairo')::date; v_new boolean := false;
begin
  if p_kind not in ('impression','click') or p_visitor is null or char_length(p_visitor) not between 16 and 64 then return; end if;
  if not exists (select 1 from public.ad_campaigns c join public.ad_slots s on s.id = c.slot_id where c.id = p_campaign and s.active and c.status = 'approved' and v_day between c.starts_on and c.ends_on) then return; end if;
  insert into public.ad_seen(campaign_id, day, visitor_hash) values (p_campaign, v_day, p_visitor) on conflict do nothing;
  get diagnostics v_new = row_count;
  insert into public.ad_daily_stats(campaign_id, day, impressions, clicks, unique_viewers)
  values (p_campaign, v_day, case when p_kind = 'impression' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end, case when v_new then 1 else 0 end)
  on conflict (campaign_id, day) do update set impressions = public.ad_daily_stats.impressions + excluded.impressions, clicks = public.ad_daily_stats.clicks + excluded.clicks, unique_viewers = public.ad_daily_stats.unique_viewers + excluded.unique_viewers;
end $$;
create or replace function public.staff_ad_revenue_report()
returns table(slot_name text, campaigns bigint, agreed_total_egp bigint, paid_total_egp bigint, unpaid_total_egp bigint, impressions bigint, clicks bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select s.name, count(c.id), coalesce(sum(c.agreed_price_egp),0)::bigint, coalesce(sum(c.agreed_price_egp) filter (where c.paid_status='paid'),0)::bigint, coalesce(sum(c.agreed_price_egp) filter (where c.paid_status='unpaid'),0)::bigint,
    coalesce((select sum(d.impressions) from public.ad_daily_stats d join public.ad_campaigns c2 on c2.id=d.campaign_id where c2.slot_id=s.id),0)::bigint,
    coalesce((select sum(d.clicks) from public.ad_daily_stats d join public.ad_campaigns c2 on c2.id=d.campaign_id where c2.slot_id=s.id),0)::bigint
  from public.ad_slots s left join public.ad_campaigns c on c.slot_id = s.id group by s.id, s.name order by s.name;
end $$;
do $$ declare f text; begin
  foreach f in array array['staff_save_ad_slot(integer,text,text,text,integer,integer,boolean)','staff_save_ad_campaign(uuid,integer,text,text,text,text,text,text,date,date,integer,text)','staff_set_ad_paid(uuid,boolean)','staff_ad_revenue_report()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ads_for_location(text)','ad_track(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
