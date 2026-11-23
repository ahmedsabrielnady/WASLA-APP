-- Restrict direct writes to service catalogue tables.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.
-- All price mutations must go through admin_update_service_item_price,
-- which enforces founder-only access and writes an audit row.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.service_items FROM authenticated;
GRANT SELECT ON TABLE public.service_items TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.service_item_price_audit FROM authenticated;
GRANT SELECT ON TABLE public.service_item_price_audit TO authenticated;
