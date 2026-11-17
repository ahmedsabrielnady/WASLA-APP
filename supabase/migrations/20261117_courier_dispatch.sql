-- WASLA courier onboarding and controlled order dispatch.
-- Apply after 20261117_operations_dashboard.sql and 20261117_order_lifecycle.sql.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.wasla_notifications') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL
     OR to_regprocedure('public.wasla_order_status_transition_allowed(text,text)') IS NULL THEN
    RAISE EXCEPTION 'WASLA courier migration prerequisites are missing; apply operations, notifications, and lifecycle migrations first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.orders'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'WASLA courier migration stopped: orders RLS must be enabled';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.wasla_courier_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 100),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 8 AND 24),
  city text NOT NULL DEFAULT 'شبين القناطر' CHECK (length(btrim(city)) BETWEEN 2 AND 100),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorcycle','car','bicycle','other')),
  vehicle_plate text NOT NULL DEFAULT '' CHECK (length(vehicle_plate) <= 40),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_courier_applications_owner_created_idx
  ON public.wasla_courier_applications(applicant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wasla_courier_applications_status_created_idx
  ON public.wasla_courier_applications(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wasla_courier_one_pending_application_uidx
  ON public.wasla_courier_applications(applicant_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.wasla_courier_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  phone text NOT NULL,
  city text NOT NULL,
  vehicle_type text NOT NULL,
  vehicle_plate text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wasla_courier_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasla_courier_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wasla_courier_applications_select_own ON public.wasla_courier_applications;
DROP POLICY IF EXISTS wasla_courier_applications_insert_own ON public.wasla_courier_applications;
DROP POLICY IF EXISTS wasla_courier_applications_founder_select ON public.wasla_courier_applications;
DROP POLICY IF EXISTS wasla_courier_applications_founder_update ON public.wasla_courier_applications;
CREATE POLICY wasla_courier_applications_select_own
  ON public.wasla_courier_applications FOR SELECT TO authenticated
  USING (applicant_id = auth.uid());
CREATE POLICY wasla_courier_applications_insert_own
  ON public.wasla_courier_applications FOR INSERT TO authenticated
  WITH CHECK (applicant_id = auth.uid() AND status = 'pending'
    AND admin_note IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL);
CREATE POLICY wasla_courier_applications_founder_select
  ON public.wasla_courier_applications FOR SELECT TO authenticated
  USING (public.wasla_can_manage_operations());
CREATE POLICY wasla_courier_applications_founder_update
  ON public.wasla_courier_applications FOR UPDATE TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

DROP POLICY IF EXISTS wasla_courier_profiles_founder_all ON public.wasla_courier_profiles;
DROP POLICY IF EXISTS wasla_courier_profiles_self_read ON public.wasla_courier_profiles;
CREATE POLICY wasla_courier_profiles_founder_all
  ON public.wasla_courier_profiles FOR ALL TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());
CREATE POLICY wasla_courier_profiles_self_read
  ON public.wasla_courier_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.wasla_courier_applications FROM anon, authenticated;
GRANT SELECT ON TABLE public.wasla_courier_applications TO authenticated;
GRANT INSERT (applicant_id, full_name, phone, city, vehicle_type, vehicle_plate)
  ON TABLE public.wasla_courier_applications TO authenticated;
GRANT UPDATE (status, admin_note, reviewed_by, reviewed_at)
  ON TABLE public.wasla_courier_applications TO authenticated;

REVOKE ALL ON TABLE public.wasla_courier_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.wasla_courier_profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.wasla_courier_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_touch_courier_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_touch_courier_records() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_courier_application_touch ON public.wasla_courier_applications;
CREATE TRIGGER wasla_courier_application_touch
BEFORE UPDATE ON public.wasla_courier_applications
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_courier_records();
DROP TRIGGER IF EXISTS wasla_courier_profile_touch ON public.wasla_courier_profiles;
CREATE TRIGGER wasla_courier_profile_touch
BEFORE UPDATE ON public.wasla_courier_profiles
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_courier_records();

CREATE OR REPLACE FUNCTION public.wasla_prevent_courier_deactivation_with_open_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false AND EXISTS (
    SELECT 1 FROM public.orders
    WHERE courier_id = OLD.user_id AND status IN ('assigned','out_for_delivery')
  ) THEN
    RAISE EXCEPTION 'Courier has active assigned orders; reassign or complete them before deactivation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_prevent_courier_deactivation_with_open_jobs() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_courier_prevent_deactivation_with_jobs ON public.wasla_courier_profiles;
CREATE TRIGGER wasla_courier_prevent_deactivation_with_jobs
BEFORE UPDATE OF is_active ON public.wasla_courier_profiles
FOR EACH ROW EXECUTE FUNCTION public.wasla_prevent_courier_deactivation_with_open_jobs();

CREATE OR REPLACE FUNCTION public.wasla_is_active_courier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.wasla_courier_profiles
    WHERE user_id = auth.uid() AND is_active = true
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_is_active_courier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_is_active_courier() TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_sync_courier_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.wasla_courier_profiles(
      user_id, display_name, phone, city, vehicle_type, vehicle_plate, is_active
    )
    VALUES (
      NEW.applicant_id, NEW.full_name, NEW.phone, NEW.city,
      NEW.vehicle_type, NEW.vehicle_plate, true
    )
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      phone = EXCLUDED.phone,
      city = EXCLUDED.city,
      vehicle_type = EXCLUDED.vehicle_type,
      vehicle_plate = EXCLUDED.vehicle_plate,
      is_active = true,
      updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_sync_courier_approval() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_courier_application_sync ON public.wasla_courier_applications;
CREATE TRIGGER wasla_courier_application_sync
AFTER INSERT OR UPDATE OF status ON public.wasla_courier_applications
FOR EACH ROW EXECUTE FUNCTION public.wasla_sync_courier_approval();

CREATE OR REPLACE FUNCTION public.wasla_notify_courier_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_title := 'تم استلام طلب الانضمام كمندوب';
    v_body := 'تم استلام طلبك للعمل كمندوب توصيل وهو الآن قيد المراجعة.';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_title := 'تم تحديث طلب المندوب';
    v_body := CASE NEW.status
      WHEN 'approved' THEN 'تم قبول طلبك مبدئيًا. أصبح حسابك مؤهلًا لاستلام مهام التوصيل بعد تفعيل الإدارة.'
      WHEN 'rejected' THEN 'لم تتم الموافقة على طلب المندوب. راجع ملاحظة الإدارة.'
      ELSE 'تم تحديث حالة طلب المندوب.'
    END;
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (NEW.applicant_id,v_title,v_body,'courier_application_' || NEW.status,'courier-application:' || NEW.id::text);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_notify_courier_application() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_courier_application_notify ON public.wasla_courier_applications;
CREATE TRIGGER wasla_courier_application_notify
AFTER INSERT OR UPDATE OF status ON public.wasla_courier_applications
FOR EACH ROW EXECUTE FUNCTION public.wasla_notify_courier_application();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS courier_id uuid REFERENCES public.wasla_courier_profiles(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS courier_assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS wasla_orders_courier_status_created_idx
  ON public.orders(courier_id,status,created_at DESC);
-- Couriers and staff may change only the status column through RLS policies.
-- Assignment itself is available only through the SECURITY DEFINER RPC.
REVOKE UPDATE ON TABLE public.orders FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON TABLE public.orders TO authenticated;


CREATE OR REPLACE FUNCTION public.wasla_authorize_order_status_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
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
  IF public.wasla_is_active_courier()
     AND (
       (OLD.status = 'assigned' AND NEW.status = 'out_for_delivery')
       OR (OLD.status = 'out_for_delivery' AND NEW.status = 'delivered')
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This account is not authorized to change the order status' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_authorize_order_status_actor() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_authorize_status_actor ON public.orders;
CREATE TRIGGER wasla_orders_authorize_status_actor
BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_authorize_order_status_actor();

CREATE OR REPLACE FUNCTION public.wasla_protect_courier_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.courier_id IS NOT NULL THEN
    RAISE EXCEPTION 'Courier assignment must be performed by the authorized dispatch RPC' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.courier_id IS DISTINCT FROM OLD.courier_id
     AND current_setting('wasla.courier_assignment', true) IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'Courier assignment must be performed by the authorized dispatch RPC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_protect_courier_assignment() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_protect_courier_assignment ON public.orders;
CREATE TRIGGER wasla_orders_protect_courier_assignment
BEFORE INSERT OR UPDATE OF courier_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_protect_courier_assignment();

CREATE OR REPLACE FUNCTION public.wasla_require_courier_for_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IN ('assigned','out_for_delivery') AND NEW.courier_id IS NULL THEN
    RAISE EXCEPTION 'A courier must be assigned before dispatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_require_courier_for_dispatch() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_require_courier_for_dispatch ON public.orders;
CREATE TRIGGER wasla_orders_require_courier_for_dispatch
BEFORE INSERT OR UPDATE OF status,courier_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_require_courier_for_dispatch();

DO $dispatch_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE status IN ('assigned','out_for_delivery') AND courier_id IS NULL
  ) THEN
    RAISE EXCEPTION 'WASLA courier migration stopped: existing dispatched orders need explicit courier reconciliation';
  END IF;
END;
$dispatch_preflight$;

DROP POLICY IF EXISTS wasla_orders_courier_read_assigned ON public.orders;
DROP POLICY IF EXISTS wasla_orders_courier_update_assigned ON public.orders;
CREATE POLICY wasla_orders_courier_read_assigned
  ON public.orders FOR SELECT TO authenticated
  USING (courier_id = auth.uid() AND public.wasla_is_active_courier());
CREATE POLICY wasla_orders_courier_update_assigned
  ON public.orders FOR UPDATE TO authenticated
  USING (
    courier_id = auth.uid()
    AND public.wasla_is_active_courier()
    AND status IN ('assigned','out_for_delivery')
  )
  WITH CHECK (
    courier_id = auth.uid()
    AND public.wasla_is_active_courier()
    AND status IN ('out_for_delivery','delivered')
  );

CREATE OR REPLACE FUNCTION public.wasla_assign_courier(p_order_id text, p_courier_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF NOT public.wasla_can_manage_operations() THEN
    RAISE EXCEPTION 'Not authorized to assign couriers' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.wasla_courier_profiles
  WHERE user_id = p_courier_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Courier is not active or does not exist' USING ERRCODE = '23503';
  END IF;

  PERFORM set_config('wasla.courier_assignment','authorized',true);
  UPDATE public.orders
  SET courier_id = p_courier_id,
      courier_assigned_at = now(),
      status = CASE WHEN status = 'ready_for_pickup' THEN 'assigned' ELSE status END
  WHERE id::text = p_order_id
    AND (
      (status = 'ready_for_pickup' AND courier_id IS NULL)
      OR (status = 'assigned' AND courier_id IS NOT NULL)
    );

  PERFORM set_config('wasla.courier_assignment','',true);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Order is not ready for initial assignment or safe reassignment' USING ERRCODE = '23514';
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_assign_courier(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_assign_courier(text, uuid) TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'wasla_courier_one_pending_application_uidx'
  ) THEN
    RAISE EXCEPTION 'WASLA courier verification failed: pending application uniqueness missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND policyname = 'wasla_orders_courier_read_assigned' AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND policyname = 'wasla_orders_courier_update_assigned' AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'WASLA courier verification failed: assigned-order policies missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'courier_id'
  ) THEN
    RAISE EXCEPTION 'WASLA courier verification failed: orders.courier_id missing';
  END IF;
END;
$verify$;

COMMIT;
