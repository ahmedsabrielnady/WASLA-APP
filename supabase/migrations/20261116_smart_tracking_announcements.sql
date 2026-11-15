-- WASLA smart tracking, notifications and announcements
-- Apply once in Supabase SQL Editor; safe to re-run.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.wasla_set_order_tracking_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tracking_code IS NULL OR btrim(NEW.tracking_code) = '' THEN
    NEW.tracking_code := 'WAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wasla_orders_tracking_fields ON public.orders;
CREATE TRIGGER wasla_orders_tracking_fields
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_set_order_tracking_fields();

CREATE TABLE IF NOT EXISTS public.wasla_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL,
 body text NOT NULL,
 type text NOT NULL DEFAULT 'info',
  order_id text,
  read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT ow()
);
CREATE INDEX IF NOT EXISTS wasla_notifications_user_created_idx ON public.wasla_notifications(user_id, created_at DESC);
ALTER TABLE public.wasla_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wasla_notifications_select_own ON public.wasla_notifications;
DROP POLICY IF EXISTS wasla_notifications_update_own ON public.wasla_notifications;
CREATE POLICY wasla_notifications_select_own ON public.wasla_notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY wasla_notifications_update_own ON public.wasla_notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, UPDATE ON public.wasla_notifications TO authenticated;

CREATE TABLE IF NOT EXISTS public.wasla_announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 message text NOT NULL,
  target_url text,
 is_active boolean NOT NULL DEFAULT true,
 starts_at timestamptz NOT NULL DEFAULT ow(),
  ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT ow(),
 updated_at timestamptz NOT NULL DEFAULT ow(),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS wasla_announcements_active_window_idx ON public.wasla_announcements(is_active, starts_at, ends_at);
ALTER TABLE public.wasla_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wasla_announcements_public_read ON public.wasla_announcements;
DROP POLICY IF EXISTS wasla_announcements_founder_insert ON public.wasla_announcements;
DROP POLICY IF EXISTS wasla_announcements_founder_update ON public.wasla_announcements;
DROP POLICY IF EXISTS wasla_announcements_founder_delete ON public.wasla_announcements;
CREATE POLICY wasla_announcements_public_read ON public.wasla_announcements FOR SELECT TO anon, authenticated USING (is_active = true AND starts_at &lt;= now() AND (ends_at IS NULL OR ends_at > now()));
CREATE POLICY wasla_announcements_founder_insert ON public.wasla_announcements FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'admin'));
CREATE POLICY wasla_announcements_founder_update ON public.wasla_announcements FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'admin')) WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'admin'));
CREATE POLICY wasla_announcements_founder_delete ON public.wasla_announcements FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'admin'));
GRANT SELECT ON public.wasla_announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wasla_announcements TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_notify_order_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
  v_body text;
  v_type text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
 v_title := 'تم استلام طلبك';
 v_body := 'تم تسجيل طلب ' || coalesce(NEW.sector, 'الخدمة') || ' ورقم التتبع ' || coalesce(NEW.tracking_code, 'قيد الإصدار') || '. الحالة: ' || coalesce(NEW.status, 'قيد المراجعة');
 v_type := 'order_created';
 ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
 v_title := 'تم تحديث حالة طلبك';
 v_body := 'تغيرت حالة طلب ' || coalesce(NEW.sector, 'الخدمة') || ' رقم ' || coalesce(NEW.tracking_code, NEW.id::text) || ' إلى: ' || coalesce(NEW.status, 'غير محدد');
 v_type := 'order_status_changed';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.wasla_notifications(user_id, title, body, type, order_id)
  VALUES (NEW.user_id, v_title, v_body, v_type, NEW.id::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wasla_orders_notify_owner ON public.orders;
CREATE TRIGGER wasla_orders_notify_owner
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_notify_order_owner();
