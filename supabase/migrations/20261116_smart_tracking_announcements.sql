-- WASLA smart tracking, in-app notifications, clinic reminders and ticker management.
-- Apply this migration once in Supabase SQL Editor. It is intentionally additive.

BEGIN;

-- Orders: preserve the existing integer order_number and its sequence.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.orders
SET tracking_code = 'WAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE tracking_code IS NULL OR btrim(tracking_code) = '';

UPDATE public.orders
SET updated_at = coalesce(created_at, now())
WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking_code_uidx
  ON public.orders(tracking_code)
  WHERE tracking_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.wasla_set_order_tracking_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.tracking_code IS NULL OR btrim(NEW.tracking_code) = '' THEN
    NEW.tracking_code := 'WAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS wasla_orders_tracking_fields ON public.orders;
CREATE TRIGGER wasla_orders_tracking_fields
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_set_order_tracking_fields();

-- Private in-app notifications. Clients can read their own notifications and
-- update ONLY read_at; inserts are performed by trusted SECURITY DEFINER triggers.
CREATE TABLE IF NOT EXISTS public.wasla_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  order_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_notifications_user_created_idx
  ON public.wasla_notifications(user_id, created_at DESC);

ALTER TABLE public.wasla_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wasla_notifications_select_own ON public.wasla_notifications;
DROP POLICY IF EXISTS wasla_notifications_update_own ON public.wasla_notifications;

CREATE POLICY wasla_notifications_select_own
  ON public.wasla_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY wasla_notifications_update_own
  ON public.wasla_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.wasla_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.wasla_notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.wasla_notifications TO authenticated;

-- Use the existing offers_ticker table. Do not create a parallel announcements store.
ALTER TABLE public.offers_ticker
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offers_ticker_active_window_idx
  ON public.offers_ticker(is_active, starts_at, ends_at, sort_order);

CREATE OR REPLACE FUNCTION public.wasla_can_manage_ticker()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT
    coalesce(public.is_founder(), false)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'founder')
    )
    OR coalesce(auth.jwt() -> 'app_metadata' ->> 'role' IN ('admin', 'founder'), false);
$function$;

ALTER TABLE public.offers_ticker ENABLE ROW LEVEL SECURITY;
DO $block$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'offers_ticker'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.offers_ticker', p.policyname);
  END LOOP;
END;
$block$;

CREATE POLICY offers_ticker_public_read
  ON public.offers_ticker FOR SELECT TO anon, authenticated
  USING (
    coalesce(is_active, false)
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  );

CREATE POLICY offers_ticker_manager_all
  ON public.offers_ticker FOR ALL TO authenticated
  USING (public.wasla_can_manage_ticker())
  WITH CHECK (public.wasla_can_manage_ticker());

REVOKE ALL ON TABLE public.offers_ticker FROM anon, authenticated;
GRANT SELECT ON TABLE public.offers_ticker TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.offers_ticker TO authenticated;

-- Order lifecycle notifications.
CREATE OR REPLACE FUNCTION public.wasla_notify_order_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_title text;
  v_body text;
  v_type text;
BEGIN
  IF NEW.user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_title := 'تم استلام طلبك';
    v_body := 'تم تسجيل طلب ' || coalesce(NEW.sector, 'الخدمة')
      || ' ورقم التتبع ' || coalesce(NEW.tracking_code, 'قيد الإصدار')
      || '. الحالة: ' || coalesce(NEW.status, 'قيد المراجعة');
    v_type := 'order_created';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_title := 'تم تحديث حالة طلبك';
    v_body := 'تغيرت حالة طلب ' || coalesce(NEW.sector, 'الخدمة')
      || ' رقم ' || coalesce(NEW.tracking_code, NEW.id::text)
      || ' إلى: ' || coalesce(NEW.status, 'غير محدد');
    v_type := 'order_status_changed';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.wasla_notifications(user_id, title, body, type, order_id)
  VALUES (NEW.user_id, v_title, v_body, v_type, NEW.id::text);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS wasla_orders_notify_owner ON public.orders;
CREATE TRIGGER wasla_orders_notify_owner
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_notify_order_owner();

-- Clinic appointment creation/status notifications.
CREATE OR REPLACE FUNCTION public.wasla_notify_appointment_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_title text;
  v_body text;
  v_type text;
BEGIN
  IF NEW.patient_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = NEW.patient_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_title := 'تم استلام حجزك الطبي';
    v_body := 'تم تسجيل حجزك بتاريخ ' || NEW.appointment_date::text
      || ' الساعة ' || NEW.slot_time::text
      || '. رقم الدور: ' || coalesce(NEW.queue_number::text, 'سيحدد لاحقًا');
    v_type := 'appointment_created';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_title := 'تحديث حالة الحجز الطبي';
    v_body := 'تم تحديث حالة حجزك إلى: ' || coalesce(NEW.status, 'غير محدد')
      || ' بتاريخ ' || NEW.appointment_date::text
      || ' الساعة ' || NEW.slot_time::text;
    v_type := 'appointment_status_changed';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.wasla_notifications(user_id, title, body, type, order_id)
  VALUES (NEW.patient_id, v_title, v_body, v_type, 'appointment:' || NEW.id::text);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS wasla_appointments_notify_patient ON public.appointments;
CREATE TRIGGER wasla_appointments_notify_patient
AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.wasla_notify_appointment_patient();

-- Final structural assertions. Any failure rolls back the complete migration.
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'tracking_code'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'WASLA migration verification failed: orders tracking columns missing';
  END IF;

  IF to_regclass('public.wasla_notifications') IS NULL THEN
    RAISE EXCEPTION 'WASLA migration verification failed: notifications table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offers_ticker'
      AND column_name = 'starts_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offers_ticker'
      AND column_name = 'target_url'
  ) THEN
    RAISE EXCEPTION 'WASLA migration verification failed: ticker extensions missing';
  END IF;
END;
$verify$;

COMMIT;
