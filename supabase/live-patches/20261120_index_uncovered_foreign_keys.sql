-- WASLA live database performance patch archive
-- Applied to the connected Supabase project "wasla" as migration:
-- 20261119230700_index_uncovered_foreign_keys
--
-- Adds covering indexes for foreign keys reported by Performance Advisor.
-- This archive is not a complete baseline or standalone database setup script.

create index if not exists invites_created_by_idx on public.invites (created_by);
create index if not exists invites_used_by_idx on public.invites (used_by);

create index if not exists medical_notes_doctor_idx on public.medical_notes (doctor_id);
create index if not exists medical_notes_order_idx on public.medical_notes (order_id);
create index if not exists medical_notes_patient_idx on public.medical_notes (patient_id);

create index if not exists order_events_actor_idx on public.order_events (actor_id);

create index if not exists orders_item_idx on public.orders (item_id);
create index if not exists orders_product_idx on public.orders (product_id);

create index if not exists products_merchant_idx on public.products (merchant_id);

create index if not exists provider_schedules_provider_idx on public.provider_schedules (provider_id);
