-- Trigger functions are internal implementation details, not RPC endpoints.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.

REVOKE ALL ON FUNCTION public.sync_service_item_orderability_from_coverage()
  FROM authenticated, anon, public;
REVOKE ALL ON FUNCTION public.sync_service_item_orderability_from_provider()
  FROM authenticated, anon, public;
