-- Restrict direct execution of the ticker authorization helper.
-- The authenticated founder page calls this RPC; RLS continues to enforce
-- the same function for every INSERT/UPDATE/DELETE on offers_ticker.

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.wasla_can_manage_ticker()') IS NULL THEN
    RAISE EXCEPTION
      'WASLA ticker hardening stopped: public.wasla_can_manage_ticker() is missing. Apply 20261116_smart_tracking_announcements.sql first.';
  END IF;
END;
$guard$;

REVOKE ALL ON FUNCTION public.wasla_can_manage_ticker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_can_manage_ticker() TO authenticated;

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.wasla_can_manage_ticker()', 'EXECUTE') THEN
    RAISE EXCEPTION 'WASLA ticker hardening verification failed: anon can execute the authorization RPC';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.wasla_can_manage_ticker()', 'EXECUTE') THEN
    RAISE EXCEPTION 'WASLA ticker hardening verification failed: authenticated cannot execute the authorization RPC';
  END IF;
END;
$verify$;

COMMIT;
