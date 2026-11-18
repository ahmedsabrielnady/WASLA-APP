-- WASLA hardening: enforce merchant fulfillment sequence and courier ownership.
-- Apply after 20261123_market_checkout.sql and before production release.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regprocedure('public.wasla_is_active_courier()') IS NULL
     OR to_regprocedure('public.wasla_owns_provider_profile(uuid)') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL THEN
    RAISE EXCEPTION 'WASLA order actor hardening prerequisites are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'wasla_orders_authorize_status_actor'
      AND tgrelid = 'public.orders'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'WASLA order actor authorization trigger is missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.wasla_authorize_order_status_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.wasla_can_manage_operations()
       AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Customer-created orders must start as pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.wasla_can_manage_operations() THEN
    RETURN NEW;
  END IF;

  -- A courier may update only an order actually assigned to that same user.
  IF public.wasla_is_active_courier()
     AND OLD.courier_id = auth.uid()
     AND (
       (OLD.status = 'assigned' AND NEW.status = 'out_for_delivery')
       OR (OLD.status = 'out_for_delivery' AND NEW.status = 'delivered')
     ) THEN
    RETURN NEW;
  END IF;

  -- Merchants must follow the complete fulfillment sequence. Do not allow
  -- accepted -> ready_for_pickup or any other skipped state transition.
  IF NEW.provider_id IS NOT NULL
     AND public.wasla_owns_provider_profile(NEW.provider_id) THEN
    IF (OLD.status = 'pending' AND NEW.status IN ('accepted','cancelled'))
       OR (OLD.status = 'accepted' AND NEW.status IN ('preparing','cancelled'))
       OR (OLD.status = 'preparing' AND NEW.status IN ('ready_for_pickup','cancelled')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Merchant order must follow pending -> accepted -> preparing -> ready_for_pickup'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.user_id = auth.uid()
     AND OLD.provider_id IS NOT NULL
     AND OLD.status = 'pending'
     AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This account is not authorized to change the order status' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.wasla_authorize_order_status_actor() FROM PUBLIC;

DO $verify$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.wasla_authorize_order_status_actor()'::regprocedure)
  INTO v_definition;

  IF position('OLD.courier_id = auth.uid()' IN v_definition) = 0
     OR position('OLD.status = ''accepted'' AND NEW.status IN (''preparing'',''cancelled'')' IN v_definition) = 0
     OR position('OLD.status = ''preparing'' AND NEW.status IN (''ready_for_pickup'',''cancelled'')' IN v_definition) = 0
     OR position('Merchant order must follow' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'WASLA order actor hardening verification failed';
  END IF;
END;
$verify$;

COMMIT;
