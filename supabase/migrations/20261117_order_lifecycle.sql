-- WASLA order lifecycle transition enforcement.
-- Every status change is checked inside PostgreSQL, regardless of client/UI.
BEGIN;
CREATE OR REPLACE FUNCTION public.wasla_order_status_transition_allowed(p_current text, p_next text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT coalesce(
    CASE coalesce(nullif(btrim(p_current), ''), 'pending')
      WHEN 'pending' THEN p_next = ANY (ARRAY['accepted','cancelled']::text[])
      WHEN 'قيد المراجعة' THEN p_next = ANY (ARRAY['accepted','cancelled']::text[])
      WHEN 'accepted' THEN p_next = ANY (ARRAY['preparing','ready_for_pickup','completed','cancelled']::text[])
      WHEN 'preparing' THEN p_next = ANY (ARRAY['ready_for_pickup','completed','cancelled']::text[])
      WHEN 'ready_for_pickup' THEN p_next = ANY (ARRAY['assigned','delivered','completed','cancelled']::text[])
      WHEN 'assigned' THEN p_next = ANY (ARRAY['out_for_delivery','cancelled']::text[])
      WHEN 'out_for_delivery' THEN p_next = ANY (ARRAY['delivered']::text[])
      WHEN 'delivered' THEN p_next = ANY (ARRAY['completed']::text[])
      WHEN 'completed' THEN false
      WHEN 'cancelled' THEN false
      ELSE false
    END,
    false
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_order_status_transition_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wasla_enforce_order_status_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_order_status_transition_allowed(text, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.wasla_enforce_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT public.wasla_order_status_transition_allowed(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'Invalid WASLA order status transition: % -> %',
      coalesce(nullif(btrim(OLD.status), ''), 'pending'),
      coalesce(NEW.status, '<null>')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS wasla_orders_enforce_status_transition ON public.orders;
CREATE TRIGGER wasla_orders_enforce_status_transition
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_enforce_order_status_transition();
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE status IS NOT NULL
      AND status::text NOT IN (
        'pending','قيد المراجعة','accepted','preparing',
        'ready_for_pickup','assigned','out_for_delivery',
        'delivered','completed','cancelled'
      )
  ) THEN
    RAISE EXCEPTION 'WASLA order lifecycle migration stopped: unknown existing order statuses require an explicit mapping before deployment';
  END IF;

  IF NOT public.wasla_order_status_transition_allowed('pending','accepted')
     OR NOT public.wasla_order_status_transition_allowed('accepted','preparing')
     OR NOT public.wasla_order_status_transition_allowed('preparing','ready_for_pickup')
     OR NOT public.wasla_order_status_transition_allowed('assigned','out_for_delivery')
     OR NOT public.wasla_order_status_transition_allowed('out_for_delivery','delivered')
     OR NOT public.wasla_order_status_transition_allowed('delivered','completed')
     OR NOT public.wasla_order_status_transition_allowed('قيد المراجعة','accepted') THEN
    RAISE EXCEPTION 'WASLA order lifecycle verification failed: valid transition rejected';
  END IF;
  IF public.wasla_order_status_transition_allowed('pending','delivered')
     OR public.wasla_order_status_transition_allowed('delivered','pending')
     OR public.wasla_order_status_transition_allowed('completed','cancelled')
     OR public.wasla_order_status_transition_allowed('cancelled','accepted')
     OR public.wasla_order_status_transition_allowed('out_for_delivery','preparing') THEN
    RAISE EXCEPTION 'WASLA order lifecycle verification failed: invalid transition accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wasla_orders_enforce_status_transition' AND tgrelid = 'public.orders'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'WASLA order lifecycle verification failed: transition trigger missing';
  END IF;
END;
$verify$;
COMMIT;
