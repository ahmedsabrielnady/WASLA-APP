-- WASLA service catalog, provider schedules, and appointment booking.
-- Apply after 20261123_market_checkout.sql.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.wasla_provider_profiles') IS NULL
     OR to_regclass('public.wasla_notifications') IS NULL
     OR to_regprocedure('public.wasla_owns_provider_profile(uuid)') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL THEN
    RAISE EXCEPTION 'WASLA service booking prerequisites are missing';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.wasla_provider_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.wasla_provider_profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 140),
  category text NOT NULL DEFAULT 'عام' CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1200),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.wasla_can_manage_service_catalog(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.wasla_provider_profiles
    WHERE id = p_provider_id
      AND owner_user_id = auth.uid()
      AND sector IN ('medical','education','maintenance','automotive')
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_can_manage_service_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_can_manage_service_catalog(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS wasla_provider_services_provider_idx
  ON public.wasla_provider_services(provider_id,is_available,created_at DESC);

CREATE TABLE IF NOT EXISTS public.wasla_provider_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.wasla_provider_profiles(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  UNIQUE(provider_id,weekday,starts_at)
);

CREATE INDEX IF NOT EXISTS wasla_provider_availability_lookup_idx
  ON public.wasla_provider_availability(provider_id,weekday,is_active,starts_at);

CREATE OR REPLACE FUNCTION public.wasla_prevent_overlapping_provider_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.provider_id::text,0));
  IF NEW.is_active AND EXISTS (
    SELECT 1
    FROM public.wasla_provider_availability existing
    WHERE existing.provider_id = NEW.provider_id
      AND existing.weekday = NEW.weekday
      AND existing.is_active = true
      AND existing.id IS DISTINCT FROM NEW.id
      AND NEW.starts_at < existing.ends_at
      AND existing.starts_at < NEW.ends_at
  ) THEN
    RAISE EXCEPTION 'Provider availability windows cannot overlap on the same weekday'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_prevent_overlapping_provider_availability() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_availability_prevent_overlap ON public.wasla_provider_availability;
CREATE TRIGGER wasla_availability_prevent_overlap
BEFORE INSERT OR UPDATE OF provider_id,weekday,starts_at,ends_at,is_active
ON public.wasla_provider_availability
FOR EACH ROW EXECUTE FUNCTION public.wasla_prevent_overlapping_provider_availability();

CREATE TABLE IF NOT EXISTS public.wasla_service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code text NOT NULL UNIQUE DEFAULT ('WS' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.wasla_provider_profiles(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES public.wasla_provider_services(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  scheduled_at timestamptz NOT NULL,
  customer_phone text NOT NULL CHECK (length(btrim(customer_phone)) BETWEEN 8 AND 24),
  customer_notes text NOT NULL DEFAULT '' CHECK (length(customer_notes) <= 1200),
  provider_note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  queue_number integer CHECK (queue_number IS NULL OR queue_number > 0),
  queue_date date,
  queue_status text NOT NULL DEFAULT 'not_arrived'
    CHECK (queue_status IN ('not_arrived','waiting','called','completed','cancelled','no_show')),
  queue_arrived_at timestamptz,
  queue_called_at timestamptz,
  queue_reminder_3_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_service_bookings_customer_idx
  ON public.wasla_service_bookings(customer_id,scheduled_at DESC);
CREATE INDEX IF NOT EXISTS wasla_service_bookings_provider_idx
  ON public.wasla_service_bookings(provider_id,scheduled_at);
CREATE INDEX IF NOT EXISTS wasla_service_bookings_active_slot_idx
  ON public.wasla_service_bookings(provider_id,scheduled_at)
  WHERE status IN ('pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS wasla_service_bookings_queue_number_uidx
  ON public.wasla_service_bookings(provider_id,queue_date,queue_number)
  WHERE queue_number IS NOT NULL;

ALTER TABLE public.wasla_provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasla_provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasla_service_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wasla_services_public_read ON public.wasla_provider_services;
DROP POLICY IF EXISTS wasla_services_owner_all ON public.wasla_provider_services;
DROP POLICY IF EXISTS wasla_services_founder_all ON public.wasla_provider_services;
CREATE POLICY wasla_services_public_read
  ON public.wasla_provider_services FOR SELECT TO anon,authenticated
  USING (
    is_available = true AND EXISTS (
      SELECT 1 FROM public.wasla_provider_profiles p
      WHERE p.id = provider_id
        AND p.sector IN ('medical','education','maintenance','automotive')
        AND p.is_active = true AND p.is_published = true
    )
  );
CREATE POLICY wasla_services_owner_all
  ON public.wasla_provider_services FOR ALL TO authenticated
  USING (public.wasla_can_manage_service_catalog(provider_id))
  WITH CHECK (public.wasla_can_manage_service_catalog(provider_id));
CREATE POLICY wasla_services_founder_all
  ON public.wasla_provider_services FOR ALL TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

DROP POLICY IF EXISTS wasla_availability_public_read ON public.wasla_provider_availability;
DROP POLICY IF EXISTS wasla_availability_owner_all ON public.wasla_provider_availability;
DROP POLICY IF EXISTS wasla_availability_founder_all ON public.wasla_provider_availability;
CREATE POLICY wasla_availability_public_read
  ON public.wasla_provider_availability FOR SELECT TO anon,authenticated
  USING (
    is_active = true AND EXISTS (
      SELECT 1 FROM public.wasla_provider_profiles p
      WHERE p.id = provider_id
        AND p.sector IN ('medical','education','maintenance','automotive')
        AND p.is_active = true AND p.is_published = true
    )
  );
CREATE POLICY wasla_availability_owner_all
  ON public.wasla_provider_availability FOR ALL TO authenticated
  USING (public.wasla_can_manage_service_catalog(provider_id))
  WITH CHECK (public.wasla_can_manage_service_catalog(provider_id));
CREATE POLICY wasla_availability_founder_all
  ON public.wasla_provider_availability FOR ALL TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

DROP POLICY IF EXISTS wasla_service_bookings_customer_read ON public.wasla_service_bookings;
DROP POLICY IF EXISTS wasla_service_bookings_provider_read ON public.wasla_service_bookings;
DROP POLICY IF EXISTS wasla_service_bookings_founder_read ON public.wasla_service_bookings;
CREATE POLICY wasla_service_bookings_customer_read
  ON public.wasla_service_bookings FOR SELECT TO authenticated
  USING (customer_id = auth.uid());
CREATE POLICY wasla_service_bookings_provider_read
  ON public.wasla_service_bookings FOR SELECT TO authenticated
  USING (public.wasla_owns_provider_profile(provider_id));
CREATE POLICY wasla_service_bookings_founder_read
  ON public.wasla_service_bookings FOR SELECT TO authenticated
  USING (public.wasla_can_manage_operations());

REVOKE ALL ON TABLE public.wasla_provider_services FROM anon,authenticated;
GRANT SELECT ON TABLE public.wasla_provider_services TO anon,authenticated;
GRANT INSERT (provider_id,name,category,description,price,duration_minutes,is_available)
  ON TABLE public.wasla_provider_services TO authenticated;
GRANT UPDATE (name,category,description,price,duration_minutes,is_available)
  ON TABLE public.wasla_provider_services TO authenticated;
GRANT DELETE ON TABLE public.wasla_provider_services TO authenticated;

REVOKE ALL ON TABLE public.wasla_provider_availability FROM anon,authenticated;
GRANT SELECT ON TABLE public.wasla_provider_availability TO anon,authenticated;
GRANT INSERT (provider_id,weekday,starts_at,ends_at,slot_minutes,is_active)
  ON TABLE public.wasla_provider_availability TO authenticated;
GRANT UPDATE (weekday,starts_at,ends_at,slot_minutes,is_active)
  ON TABLE public.wasla_provider_availability TO authenticated;
GRANT DELETE ON TABLE public.wasla_provider_availability TO authenticated;

REVOKE ALL ON TABLE public.wasla_service_bookings FROM anon,authenticated;
GRANT SELECT ON TABLE public.wasla_service_bookings TO authenticated;

ALTER TABLE public.wasla_service_bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.wasla_touch_service_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog,public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_touch_service_records() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_services_touch ON public.wasla_provider_services;
CREATE TRIGGER wasla_services_touch
BEFORE UPDATE ON public.wasla_provider_services
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_service_records();
DROP TRIGGER IF EXISTS wasla_availability_touch ON public.wasla_provider_availability;
CREATE TRIGGER wasla_availability_touch
BEFORE UPDATE ON public.wasla_provider_availability
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_service_records();
DROP TRIGGER IF EXISTS wasla_service_bookings_touch ON public.wasla_service_bookings;
CREATE TRIGGER wasla_service_bookings_touch
BEFORE UPDATE ON public.wasla_service_bookings
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_service_records();

CREATE OR REPLACE FUNCTION public.wasla_create_service_booking(
  p_service_id uuid,
  p_scheduled_at timestamptz,
  p_customer_phone text,
  p_customer_notes text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_service public.wasla_provider_services%ROWTYPE;
  v_provider public.wasla_provider_profiles%ROWTYPE;
  v_window public.wasla_provider_availability%ROWTYPE;
  v_local timestamp;
  v_booking_id uuid;
  v_owner uuid;
  v_conflict boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before booking a service' USING ERRCODE = '42501';
  END IF;
  IF p_customer_phone IS NULL OR length(btrim(p_customer_phone)) NOT BETWEEN 8 AND 24 THEN
    RAISE EXCEPTION 'A valid contact phone is required' USING ERRCODE = '22023';
  END IF;
  IF p_customer_notes IS NOT NULL AND length(p_customer_notes) > 1200 THEN
    RAISE EXCEPTION 'Booking notes are too long' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at <= now()
     OR p_scheduled_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose an appointment within the next 90 days' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_service
  FROM public.wasla_provider_services
  WHERE id = p_service_id AND is_available = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This service is not currently available' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_provider
  FROM public.wasla_provider_profiles
  WHERE id = v_service.provider_id
    AND sector IN ('medical','education','maintenance','automotive')
    AND is_active = true AND is_published = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This provider is not currently accepting bookings' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_provider.id::text,0));

  v_local := p_scheduled_at AT TIME ZONE 'Africa/Cairo';
  SELECT * INTO v_window
  FROM public.wasla_provider_availability
  WHERE provider_id = v_provider.id
    AND weekday = extract(dow FROM v_local)::smallint
    AND is_active = true
    AND (v_local::time) >= starts_at
    AND (v_local::time) + make_interval(mins => v_service.duration_minutes) <= ends_at
    AND mod(extract(epoch FROM ((v_local::time) - starts_at))::integer,slot_minutes * 60) = 0
  ORDER BY starts_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected time is outside the provider schedule' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.wasla_service_bookings b
    WHERE b.provider_id = v_provider.id
      AND b.status IN ('pending','confirmed')
      AND tstzrange(
        b.scheduled_at,
        b.scheduled_at + make_interval(mins => b.duration_minutes),
        '[)'
      ) && tstzrange(
        p_scheduled_at,
        p_scheduled_at + make_interval(mins => v_service.duration_minutes),
        '[)'
      )
  ) INTO v_conflict;
  IF v_conflict THEN
    RAISE EXCEPTION 'This time has just been booked. Choose another slot.' USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.wasla_service_bookings(
    customer_id,provider_id,service_id,service_name,price,duration_minutes,
    scheduled_at,customer_phone,customer_notes,status
  )
  VALUES (
    auth.uid(),v_provider.id,v_service.id,v_service.name,v_service.price,
    v_service.duration_minutes,p_scheduled_at,btrim(p_customer_phone),
    coalesce(btrim(p_customer_notes),''),'pending'
  )
  RETURNING id INTO v_booking_id;

  SELECT owner_user_id INTO v_owner
  FROM public.wasla_provider_profiles WHERE id = v_provider.id;
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (
    v_owner,'حجز جديد من وصلة',
    'لديك طلب حجز جديد لخدمة ' || v_service.name || '. راجع لوحة مقدم الخدمة لتأكيد الموعد.',
    'service_booking_pending',NULL
  );
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (
    auth.uid(),'تم استلام طلب الحجز',
    'استلمنا طلبك لخدمة ' || v_service.name || '. الموعد غير مؤكد حتى يراجعه مقدم الخدمة.',
    'service_booking_submitted',NULL
  );
  RETURN v_booking_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_create_service_booking(uuid,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_create_service_booking(uuid,timestamptz,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_update_service_booking_status(
  p_booking_id uuid,
  p_next_status text,
  p_provider_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_booking public.wasla_service_bookings%ROWTYPE;
  v_customer_title text;
  v_customer_body text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before updating a booking' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking
  FROM public.wasla_service_bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.wasla_owns_provider_profile(v_booking.provider_id) THEN
    RAISE EXCEPTION 'Booking not found or not owned by this provider' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (v_booking.status = 'pending' AND p_next_status IN ('confirmed','cancelled'))
    OR (v_booking.status = 'confirmed' AND p_next_status IN ('completed','cancelled','no_show'))
  ) THEN
    RAISE EXCEPTION 'Invalid service booking status transition' USING ERRCODE = '23514';
  END IF;
  IF p_provider_note IS NOT NULL AND length(p_provider_note) > 1200 THEN
    RAISE EXCEPTION 'Provider note is too long' USING ERRCODE = '22023';
  END IF;
  IF p_next_status = 'no_show' AND v_booking.scheduled_at > now() THEN
    RAISE EXCEPTION 'A booking cannot be marked no-show before its scheduled time' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wasla_service_bookings
  SET status = p_next_status,
      provider_note = coalesce(nullif(btrim(p_provider_note),''),provider_note),
      queue_status = CASE
        WHEN p_next_status = 'completed' THEN 'completed'
        WHEN p_next_status = 'cancelled' THEN 'cancelled'
        WHEN p_next_status = 'no_show' THEN 'no_show'
        ELSE queue_status
      END
  WHERE id = p_booking_id;

  v_customer_title := CASE p_next_status
    WHEN 'confirmed' THEN 'تم تأكيد موعدك'
    WHEN 'cancelled' THEN 'تم إلغاء موعدك'
    WHEN 'completed' THEN 'تم إتمام الخدمة'
    ELSE 'تم تحديث حالة موعدك'
  END;
  v_customer_body := 'الخدمة: ' || v_booking.service_name ||
    ' · الموعد: ' || to_char(v_booking.scheduled_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') ||
    ' · الحالة: ' || p_next_status;
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (v_booking.customer_id,v_customer_title,v_customer_body,'service_booking_' || p_next_status,NULL);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_update_service_booking_status(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_update_service_booking_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_cancel_service_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_booking public.wasla_service_bookings%ROWTYPE;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before cancelling a booking' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking
  FROM public.wasla_service_bookings
  WHERE id = p_booking_id AND customer_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_booking.status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'Booking not found or no longer cancellable' USING ERRCODE = '42501';
  END IF;
  IF v_booking.status = 'confirmed' AND v_booking.scheduled_at <= now() + interval '12 hours' THEN
    RAISE EXCEPTION 'Confirmed bookings can only be cancelled at least 12 hours in advance' USING ERRCODE = '22023';
  END IF;
  UPDATE public.wasla_service_bookings
  SET status='cancelled',queue_status='cancelled'
  WHERE id=p_booking_id;
  SELECT owner_user_id INTO v_owner FROM public.wasla_provider_profiles WHERE id=v_booking.provider_id;
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (v_owner,'تم إلغاء حجز','ألغى العميل حجز ' || v_booking.service_name || '.','service_booking_cancelled',NULL);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_cancel_service_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_cancel_service_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_send_service_booking_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public
AS $function$
DECLARE
  v_sent integer := 0;
  v_rows integer := 0;
BEGIN
  WITH due AS (
    SELECT id,customer_id,service_name,scheduled_at
    FROM public.wasla_service_bookings
    WHERE status = 'confirmed'
      AND reminder_24h_sent_at IS NULL
      AND scheduled_at > now() + interval '1 hour'
      AND scheduled_at <= now() + interval '24 hours'
    FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.wasla_service_bookings booking
    SET reminder_24h_sent_at = now()
    FROM due
    WHERE booking.id = due.id
    RETURNING due.customer_id,due.service_name,due.scheduled_at
  )
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  SELECT customer_id,'تذكير بموعدك القادم',
    'تذكير: لديك موعد قادم لخدمة ' || service_name || '. الموعد ' ||
    to_char(scheduled_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') || '.',
    'service_booking_reminder_24h',NULL
  FROM marked;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_sent := v_sent + v_rows;

  WITH due AS (
    SELECT id,customer_id,service_name,scheduled_at
    FROM public.wasla_service_bookings
    WHERE status = 'confirmed'
      AND reminder_1h_sent_at IS NULL
      AND scheduled_at > now()
      AND scheduled_at <= now() + interval '1 hour'
    FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.wasla_service_bookings booking
    SET reminder_1h_sent_at = now()
    FROM due
    WHERE booking.id = due.id
    RETURNING due.customer_id,due.service_name,due.scheduled_at
  )
  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  SELECT customer_id,'تذكير: موعدك خلال ساعة',
    'موعدك لخدمة ' || service_name || ' خلال ساعة. الموعد ' ||
    to_char(scheduled_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') || '.',
    'service_booking_reminder_1h',NULL
  FROM marked;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_sent := v_sent + v_rows;
  RETURN v_sent;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_send_service_booking_reminders() FROM PUBLIC;

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'wasla-service-booking-reminders'
    LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'wasla-service-booking-reminders',
      '*/5 * * * *',
      'SELECT public.wasla_send_service_booking_reminders();'
    );
  ELSE
    RAISE NOTICE 'pg_cron is not enabled; service appointment reminders require pg_cron activation and scheduling.';
  END IF;
END;
$schedule$;

CREATE OR REPLACE FUNCTION public.wasla_get_available_service_slots(
  p_service_id uuid,
  p_date date
)
RETURNS TABLE(slot_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog,public
AS $function$
  SELECT DISTINCT (slots.slot_local AT TIME ZONE 'Africa/Cairo') AS slot_at
  FROM public.wasla_provider_services service
  JOIN public.wasla_provider_profiles provider
    ON provider.id = service.provider_id
  JOIN public.wasla_provider_availability availability
    ON availability.provider_id = provider.id
  CROSS JOIN LATERAL generate_series(
    (p_date + availability.starts_at)::timestamp,
    (p_date + availability.ends_at - make_interval(mins => service.duration_minutes))::timestamp,
    make_interval(mins => availability.slot_minutes)
  ) AS slots(slot_local)
  WHERE service.id = p_service_id
    AND service.is_available = true
    AND provider.sector IN ('medical','education','maintenance','automotive')
    AND provider.is_active = true
    AND provider.is_published = true
    AND availability.is_active = true
    AND availability.weekday = extract(dow FROM p_date)::smallint
    AND p_date >= (now() AT TIME ZONE 'Africa/Cairo')::date
    AND p_date <= (now() AT TIME ZONE 'Africa/Cairo')::date + 90
    AND (slots.slot_local AT TIME ZONE 'Africa/Cairo') > now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.wasla_service_bookings booking
      WHERE booking.provider_id = provider.id
        AND booking.status IN ('pending','confirmed')
        AND tstzrange(
          booking.scheduled_at,
          booking.scheduled_at + make_interval(mins => booking.duration_minutes),
          '[)'
        ) && tstzrange(
          slots.slot_local AT TIME ZONE 'Africa/Cairo',
          (slots.slot_local AT TIME ZONE 'Africa/Cairo') + make_interval(mins => service.duration_minutes),
          '[)'
        )
    )
  ORDER BY slot_at
  LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.wasla_get_available_service_slots(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_get_available_service_slots(uuid,date) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.wasla_check_in_service_booking(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_booking public.wasla_service_bookings%ROWTYPE;
  v_sector text;
  v_queue_date date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_queue_number integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before checking in a patient' USING ERRCODE = '42501';
  END IF;
  SELECT b.* INTO v_booking
  FROM public.wasla_service_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT sector INTO v_sector
  FROM public.wasla_provider_profiles
  WHERE id = v_booking.provider_id
    AND owner_user_id = auth.uid();
  IF NOT FOUND OR v_sector <> 'medical' THEN
    RAISE EXCEPTION 'Only the owning medical provider can check in this patient' USING ERRCODE = '42501';
  END IF;
  IF v_booking.status <> 'confirmed'
     OR v_booking.queue_status <> 'not_arrived'
     OR (v_booking.scheduled_at AT TIME ZONE 'Africa/Cairo')::date <> v_queue_date THEN
    RAISE EXCEPTION 'Only a confirmed appointment scheduled for today can join the clinic queue' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_booking.provider_id::text,0));
  SELECT coalesce(max(queue_number),0)+1 INTO v_queue_number
  FROM public.wasla_service_bookings
  WHERE provider_id = v_booking.provider_id AND queue_date = v_queue_date;

  UPDATE public.wasla_service_bookings
  SET queue_number = v_queue_number,
      queue_date = v_queue_date,
      queue_status = 'waiting',
      queue_arrived_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (
    v_booking.customer_id,'تم تسجيل وصولك للعيادة',
    'رقم انتظارك اليوم: ' || v_queue_number || '. ستصلك رسالة عند اقتراب دورك.',
    'medical_queue_checked_in',NULL
  );
  RETURN v_queue_number;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_check_in_service_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_check_in_service_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_call_next_service_booking(p_provider_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_next public.wasla_service_bookings%ROWTYPE;
  v_sector text;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_waiting record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before calling the next patient' USING ERRCODE = '42501';
  END IF;
  SELECT sector INTO v_sector
  FROM public.wasla_provider_profiles
  WHERE id = p_provider_id AND owner_user_id = auth.uid();
  IF NOT FOUND OR v_sector <> 'medical' THEN
    RAISE EXCEPTION 'Only the owning medical provider can manage this queue' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::text,0));
  SELECT * INTO v_next
  FROM public.wasla_service_bookings
  WHERE provider_id = p_provider_id
    AND queue_date = v_today
    AND queue_status = 'waiting'
    AND status = 'confirmed'
  ORDER BY queue_number
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.wasla_service_bookings
  SET queue_status = 'called',queue_called_at = now()
  WHERE id = v_next.id;

  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (
    v_next.customer_id,'دورك الآن',
    'يرجى التوجه إلى مقدم الخدمة. رقم انتظارك: ' || v_next.queue_number || '.',
    'medical_queue_your_turn',NULL
  );

  FOR v_waiting IN
    SELECT b.id,b.customer_id,b.queue_number,
      (SELECT count(*)::integer
       FROM public.wasla_service_bookings ahead
       WHERE ahead.provider_id = b.provider_id
         AND ahead.queue_date = b.queue_date
         AND ahead.queue_status = 'waiting'
         AND ahead.status = 'confirmed'
         AND ahead.queue_number < b.queue_number) AS remaining
    FROM public.wasla_service_bookings b
    WHERE b.provider_id = p_provider_id
      AND b.queue_date = v_today
      AND b.queue_status = 'waiting'
      AND b.status = 'confirmed'
      AND b.queue_reminder_3_sent_at IS NULL
    ORDER BY b.queue_number
    FOR UPDATE
  LOOP
    IF v_waiting.remaining BETWEEN 1 AND 3 THEN
      INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
      VALUES (
        v_waiting.customer_id,'اقترب دورك',
        'متبقي ' || v_waiting.remaining || ' حالات قبلك في قائمة الانتظار.',
        'medical_queue_three_left',NULL
      );
      UPDATE public.wasla_service_bookings
      SET queue_reminder_3_sent_at = now()
      WHERE id = v_waiting.id;
    END IF;
  END LOOP;
  RETURN v_next.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_call_next_service_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_call_next_service_booking(uuid) TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wasla_service_bookings'
      AND policyname='wasla_service_bookings_customer_read' AND cmd='SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wasla_service_bookings'
      AND policyname='wasla_service_bookings_provider_read' AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION 'WASLA service booking read policies are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='wasla_service_bookings_touch'
      AND tgrelid='public.wasla_service_bookings'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'WASLA service booking updated_at trigger is missing';
  END IF;
END;
$verify$;

COMMIT;
