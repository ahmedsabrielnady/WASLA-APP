-- Remove the now-unreachable public provider discovery policy.
-- The application reads provider records only after authentication.
DROP POLICY IF EXISTS providers_public_read ON public.providers;

-- Harden default privileges for objects created by the postgres migration owner.
-- The Supabase-managed supabase_admin default ACL is managed by the platform and
-- cannot be changed by this project's current database role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
