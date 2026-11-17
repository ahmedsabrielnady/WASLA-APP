-- WASLA founder/operations dashboard access.
-- Additive migration: preserves existing customer policies and restricts staff
-- access to authenticated founder/admin accounts only.

BEGIN;

CREATE OR REPLACE FUNCTION public.wasla_can_manage_operations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT
    coalesce(public.is_founder(), false)
    OR EXISTS (
      SELECT 1
      FROM public.users
      WHERE id = auth.uid()
        AND role IN ('admin', 'founder')
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'founder')
    )
    OR coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role' IN ('admin', 'founder'),
      false
    );
$function$;

REVOKE ALL ON FUNCTION public.wasla_can_manage_operations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_can_manage_operations() TO authenticated;

-- Never silently turn RLS on here: doing so without reviewing all existing
-- customer insert/select policies could break the customer ordering flow.
DO $guard$
DECLARE
  v_rls_enabled boolean;
BEGIN
  SELECT relrowsecurity
  INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.orders'::regclass;

  IF coalesce(v_rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION
      'WASLA operations migration stopped: public.orders does not have RLS enabled. Review its existing customer policies first.';
  END IF;
END;
$guard$;

DROP POLICY IF EXISTS wasla_orders_staff_read ON public.orders;
CREATE POLICY wasla_orders_staff_read
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.wasla_can_manage_operations());

DROP POLICY IF EXISTS wasla_orders_staff_status_update ON public.orders;
CREATE POLICY wasla_orders_staff_status_update
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT UPDATE (status) ON TABLE public.orders TO authenticated;

CREATE INDEX IF NOT EXISTS wasla_orders_status_created_idx
  ON public.orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS wasla_orders_sector_created_idx
  ON public.orders(sector, created_at DESC);

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND policyname = 'wasla_orders_staff_read'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'WASLA operations migration verification failed: staff read policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND policyname = 'wasla_orders_staff_status_update'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'WASLA operations migration verification failed: staff status update policy missing';
  END IF;
END;
$verify$;

COMMIT;
