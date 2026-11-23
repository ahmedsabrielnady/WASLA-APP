-- Provider coverage changes are only permitted through the founder-only RPC.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.provider_service_coverage FROM authenticated;
GRANT SELECT ON TABLE public.provider_service_coverage TO authenticated;
