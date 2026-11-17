-- WASLA customer complaints and suggestions with founder/admin responses.
-- Apply after the provider, market, and appointment foundations.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.wasla_notifications') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL THEN
    RAISE EXCEPTION 'WASLA feedback center prerequisites are missing';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.wasla_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code text NOT NULL UNIQUE DEFAULT ('WF' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('complaint','suggestion')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 120),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 3000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','resolved','rejected')),
  admin_reply text NOT NULL DEFAULT '' CHECK (length(admin_reply) <= 2000),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_feedback_user_created_idx
  ON public.wasla_feedback(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wasla_feedback_status_created_idx
  ON public.wasla_feedback(status,created_at DESC);

ALTER TABLE public.wasla_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wasla_feedback_customer_read ON public.wasla_feedback;
DROP POLICY IF EXISTS wasla_feedback_operations_read ON public.wasla_feedback;
CREATE POLICY wasla_feedback_customer_read
  ON public.wasla_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY wasla_feedback_operations_read
  ON public.wasla_feedback FOR SELECT TO authenticated
  USING (public.wasla_can_manage_operations());

REVOKE ALL ON TABLE public.wasla_feedback FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.wasla_feedback TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_touch_feedback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog,public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_touch_feedback() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_feedback_touch ON public.wasla_feedback;
CREATE TRIGGER wasla_feedback_touch
BEFORE UPDATE ON public.wasla_feedback
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_feedback();

CREATE OR REPLACE FUNCTION public.wasla_submit_feedback(
  p_category text,
  p_subject text,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_feedback_id uuid;
  v_tracking_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before sending feedback' USING ERRCODE = '42501';
  END IF;
  IF p_category NOT IN ('complaint','suggestion') THEN
    RAISE EXCEPTION 'Choose a complaint or suggestion' USING ERRCODE = '22023';
  END IF;
  IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Subject must contain 3 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 10 AND 3000 THEN
    RAISE EXCEPTION 'Message must contain 10 to 3000 characters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wasla_feedback(user_id,category,subject,message)
  VALUES (auth.uid(),p_category,btrim(p_subject),btrim(p_message))
  RETURNING id,tracking_code INTO v_feedback_id,v_tracking_code;

  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  SELECT id,
    CASE p_category WHEN 'complaint' THEN 'شكوى جديدة على وصلة' ELSE 'اقتراح جديد على وصلة' END,
    'وصلت رسالة جديدة رقم ' || v_tracking_code || ' وتحتاج إلى مراجعة.',
    'feedback_new',NULL
  FROM public.users
  WHERE role IN ('admin','founder');

  RETURN v_feedback_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_submit_feedback(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_submit_feedback(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_update_feedback(
  p_feedback_id uuid,
  p_status text,
  p_admin_reply text DEFAULT ''
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_feedback public.wasla_feedback%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.wasla_can_manage_operations() THEN
    RAISE EXCEPTION 'Only authorized operations staff can update feedback' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open','in_progress','resolved','rejected') THEN
    RAISE EXCEPTION 'Invalid feedback status' USING ERRCODE = '22023';
  END IF;
  IF p_admin_reply IS NOT NULL AND length(p_admin_reply) > 2000 THEN
    RAISE EXCEPTION 'Admin reply is too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_feedback
  FROM public.wasla_feedback
  WHERE id = p_feedback_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback item not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.wasla_feedback
  SET status = p_status,
      admin_reply = coalesce(btrim(p_admin_reply),''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_feedback_id;

  IF v_feedback.status IS DISTINCT FROM p_status
     OR v_feedback.admin_reply IS DISTINCT FROM coalesce(btrim(p_admin_reply),'') THEN
    INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
    VALUES (
      v_feedback.user_id,'تم تحديث رسالتك على وصلة',
      'تم تحديث حالة رسالتك رقم ' || v_feedback.tracking_code ||
      ' إلى ' || p_status ||
      CASE WHEN coalesce(btrim(p_admin_reply),'') <> '' THEN '. رد الإدارة: ' || btrim(p_admin_reply) ELSE '.' END,
      'feedback_' || p_status,NULL
    );
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_update_feedback(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_update_feedback(uuid,text,text) TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wasla_feedback'
      AND policyname='wasla_feedback_customer_read' AND cmd='SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wasla_feedback'
      AND policyname='wasla_feedback_operations_read' AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION 'WASLA feedback RLS policies are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='wasla_feedback_touch'
      AND tgrelid='public.wasla_feedback'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'WASLA feedback updated_at trigger is missing';
  END IF;
END;
$verify$;

COMMIT;
