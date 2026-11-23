-- Cover audit actor foreign keys so user/profile deletes and joins do not
-- require full scans of the audit/coverage tables.
create index if not exists provider_service_coverage_created_by_idx
  on public.provider_service_coverage (created_by);

create index if not exists provider_service_coverage_updated_by_idx
  on public.provider_service_coverage (updated_by);

create index if not exists service_item_price_audit_changed_by_idx
  on public.service_item_price_audit (changed_by);
