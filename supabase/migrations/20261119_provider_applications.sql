-- WASLA provider application workflow.
-- Customers can submit and view only their own applications. Founder review is
-- enforced by RLS and column-level grants; client-supplied approval fields are not writable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.wasla_provider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sector text NOT NULL CHECK (sector IN ('medical','education','restaurants','market','maintenance','automotive','delivery')),
  business_name text NOT NULL CHECK (length(btrim(business_name)) BETWEEN 2 AND 140),
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 100),
  contact_phone text NOT NULL CHECK (length(btrim(contact_phone)) BETWEEN 8 AND 24),
  city text NOT NULL DEFAULT 'شبين القناطر',
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 3 AND 240),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_provider_applications_owner_created_idx
  ON public.wasla_provider_applications(applicant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wasla_provider_applications_status_created_idx
  ON public.wasla_provider_applications(status, created_at DESC);

ALTER TABLE public.wasla_provider_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wasla_provider_applications_select_own ON public.wasla_provider_applications;
DROP POLICY IF EXISTS wasla_provider_applications_insert_own ON public.wasla_provider_applications;
DROP POLICY IF EXISTS wasla_provider_applications_update_own_pending ON public.wasla_provider_applications;
DROP POLICY IF EXISTS wasla_provider_applications_founder_select ON public.wasla_provider_applications;
DROP POLICY IF EXISTS wasla_provider_applications_founder_update ON public.wasla_provider_applications;

CREATE POLICY wasla_provider_applications_select_own
  ON public.wasla_provider_applications FOR SELECT TO authenticated
  USING (applicant_id = auth.uid());

CREATE POLICY wasla_provider_applications_insert_own
  ON public.wasla_provider_applications FOR INSERT TO authenticated
  WITH CHECK (applicant_id = auth.uid() AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);

CREATE POLICY wasla_provider_applications_update_own_pending
  ON public.wasla_provider_applications FOR UPDATE TO authenticated
  USING (applicant_id = auth.uid() AND status = 'pending')
  WITH CHECK (applicant_id = auth.uid() AND status = 'pending');

CREATE POLICY wasla_provider_applications_founder_select
  ON public.wasla_provider_applications FOR SELECT TO authenticated
  USING (coalesce(public.is_founder(), false));

CREATE POLICY wasla_provider_applications_founder_update
  ON public.wasla_provider_applications FOR UPDATE TO authenticated
  USING (coalesce(public.is_founder(), false))
  WITH CHECK (coalesce(public.is_founder(), false));

REVOKE ALL ON TABLE public.wasla_provider_applications FROM anon, authenticated;
GRANT SELECT ON TABLE public.wasla_provider_applications TO authenticated;
GRANT INSERT (applicant_id, sector, business_name, contact_name, contact_phone, city, address, description)
  ON TABLE public.wasla_provider_applications TO authenticated;
GRANT UPDATE (business_name, contact_name, contact_phone, city, address, description)
  ON TABLE public.wasla_provider_applications TO authenticated;
GRANT UPDATE (status, admin_note, reviewed_by, reviewed_at)
  ON TABLE public.wasla_provider_applications TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_touch_provider_application()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS wasla_provider_application_touch ON public.wasla_provider_applications;
CREATE TRIGGER wasla_provider_application_touch
BEFORE UPDATE ON public.wasla_provider_applications
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_provider_application();

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.wasla_provider_applications'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'WASLA provider application RLS is not enabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wasla_provider_applications'
      AND policyname = 'wasla_provider_applications_insert_own'
  ) THEN
    RAISE EXCEPTION 'WASLA provider application owner insert policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wasla_provider_applications'
      AND policyname = 'wasla_provider_applications_founder_update'
  ) THEN
    RAISE EXCEPTION 'WASLA provider application founder review policy is missing';
  END IF;
END;
$verify$;

COMMIT;
