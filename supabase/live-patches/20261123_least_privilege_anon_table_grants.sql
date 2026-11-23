-- Least-privilege grants for anonymous clients.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.
-- RLS continues to control which rows are visible in these public tables.
-- Anonymous clients may only read active/public catalogue and roadmap records.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT ON TABLE
  public.service_items,
  public.offers,
  public.roadmap_milestones
TO anon;

-- Prevent future public tables created by postgres from receiving anon grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
