-- WASLA provider activation and merchant product catalog.
-- Apply after 20261119_provider_applications.sql.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.wasla_provider_applications') IS NULL
     OR to_regclass('public.wasla_notifications') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL THEN
    RAISE EXCEPTION 'WASLA provider catalog migration requires provider applications, notifications, and operations migrations first';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.wasla_provider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.wasla_provider_applications(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sector text NOT NULL CHECK (sector IN ('medical','education','restaurants','market','maintenance','automotive','delivery')),
  business_name text NOT NULL,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_published = false OR is_active = true)
);

CREATE INDEX IF NOT EXISTS wasla_provider_profiles_owner_idx
  ON public.wasla_provider_profiles(owner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wasla_provider_profiles_public_idx
  ON public.wasla_provider_profiles(sector,is_active,is_published);

CREATE TABLE IF NOT EXISTS public.wasla_provider_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.wasla_provider_profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 140),
  category text NOT NULL DEFAULT 'عام' CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wasla_provider_products_provider_created_idx
  ON public.wasla_provider_products(provider_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wasla_provider_products_public_idx
  ON public.wasla_provider_products(is_available,category);

ALTER TABLE public.wasla_provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wasla_provider_products ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.wasla_owns_provider_profile(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.wasla_provider_profiles
    WHERE id = p_provider_id AND owner_user_id = auth.uid()
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_owns_provider_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_owns_provider_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS wasla_provider_profiles_public_read ON public.wasla_provider_profiles;
DROP POLICY IF EXISTS wasla_provider_profiles_owner_read ON public.wasla_provider_profiles;
DROP POLICY IF EXISTS wasla_provider_profiles_owner_update ON public.wasla_provider_profiles;
DROP POLICY IF EXISTS wasla_provider_profiles_founder_all ON public.wasla_provider_profiles;
CREATE POLICY wasla_provider_profiles_public_read
  ON public.wasla_provider_profiles FOR SELECT TO anon,authenticated
  USING (is_active = true AND is_published = true);
CREATE POLICY wasla_provider_profiles_owner_read
  ON public.wasla_provider_profiles FOR SELECT TO authenticated
  USING (public.wasla_owns_provider_profile(id));
CREATE POLICY wasla_provider_profiles_owner_update
  ON public.wasla_provider_profiles FOR UPDATE TO authenticated
  USING (public.wasla_owns_provider_profile(id))
  WITH CHECK (public.wasla_owns_provider_profile(id));
CREATE POLICY wasla_provider_profiles_founder_all
  ON public.wasla_provider_profiles FOR ALL TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

DROP POLICY IF EXISTS wasla_provider_products_public_read ON public.wasla_provider_products;
DROP POLICY IF EXISTS wasla_provider_products_owner_all ON public.wasla_provider_products;
DROP POLICY IF EXISTS wasla_provider_products_founder_all ON public.wasla_provider_products;
CREATE POLICY wasla_provider_products_public_read
  ON public.wasla_provider_products FOR SELECT TO anon,authenticated
  USING (
    is_available = true
    AND stock_quantity > 0
    AND EXISTS (
      SELECT 1 FROM public.wasla_provider_profiles p
      WHERE p.id = provider_id AND p.sector IN ('restaurants','market') AND p.is_active = true AND p.is_published = true
    )
  );
CREATE POLICY wasla_provider_products_owner_all
  ON public.wasla_provider_products FOR ALL TO authenticated
  USING (public.wasla_can_manage_provider_catalog(provider_id))
  WITH CHECK (public.wasla_can_manage_provider_catalog(provider_id));
CREATE POLICY wasla_provider_products_founder_all
  ON public.wasla_provider_products FOR ALL TO authenticated
  USING (public.wasla_can_manage_operations())
  WITH CHECK (public.wasla_can_manage_operations());

REVOKE ALL ON TABLE public.wasla_provider_profiles FROM anon,authenticated;
GRANT SELECT (id,sector,business_name,contact_phone,city,address,description,is_active,is_published)
  ON TABLE public.wasla_provider_profiles TO anon;
GRANT SELECT (id,application_id,sector,business_name,contact_phone,city,address,description,is_active,is_published)
  ON TABLE public.wasla_provider_profiles TO authenticated;
GRANT UPDATE (business_name,contact_name,contact_phone,city,address,description)
  ON TABLE public.wasla_provider_profiles TO authenticated;
REVOKE UPDATE (is_active,is_published)
  ON TABLE public.wasla_provider_profiles FROM anon,authenticated;

REVOKE ALL ON TABLE public.wasla_provider_products FROM anon,authenticated;
GRANT SELECT ON TABLE public.wasla_provider_products TO anon,authenticated;
GRANT INSERT (provider_id,name,category,description,price,stock_quantity,is_available)
  ON TABLE public.wasla_provider_products TO authenticated;
GRANT UPDATE (name,category,description,price,stock_quantity,is_available)
  ON TABLE public.wasla_provider_products TO authenticated;
GRANT DELETE ON TABLE public.wasla_provider_products TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_touch_provider_catalog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_touch_provider_catalog() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_provider_profile_touch ON public.wasla_provider_profiles;
CREATE TRIGGER wasla_provider_profile_touch
BEFORE UPDATE ON public.wasla_provider_profiles
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_provider_catalog();
DROP TRIGGER IF EXISTS wasla_provider_product_touch ON public.wasla_provider_products;
CREATE TRIGGER wasla_provider_product_touch
BEFORE UPDATE ON public.wasla_provider_products
FOR EACH ROW EXECUTE FUNCTION public.wasla_touch_provider_catalog();

CREATE OR REPLACE FUNCTION public.wasla_sync_provider_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  INSERT INTO public.wasla_provider_profiles(
    application_id,owner_user_id,sector,business_name,contact_name,
    contact_phone,city,address,description,is_active,is_published
  )
  VALUES (
    NEW.id,NEW.applicant_id,NEW.sector,NEW.business_name,NEW.contact_name,
    NEW.contact_phone,NEW.city,NEW.address,NEW.description,false,false
  )
  ON CONFLICT (application_id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    contact_name = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    city = EXCLUDED.city,
    address = EXCLUDED.address,
    description = EXCLUDED.description,
    updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_sync_provider_approval() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_provider_application_create_profile ON public.wasla_provider_applications;
CREATE TRIGGER wasla_provider_application_create_profile
AFTER INSERT OR UPDATE OF status ON public.wasla_provider_applications
FOR EACH ROW EXECUTE FUNCTION public.wasla_sync_provider_approval();

INSERT INTO public.wasla_provider_profiles(
  application_id,owner_user_id,sector,business_name,contact_name,
  contact_phone,city,address,description,is_active,is_published
)
SELECT
  id,applicant_id,sector,business_name,contact_name,
  contact_phone,city,address,description,false,false
FROM public.wasla_provider_applications
WHERE status = 'approved'
ON CONFLICT (application_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wasla_set_provider_state(
  p_provider_id uuid,
  p_is_active boolean,
  p_is_published boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
BEGIN
  IF NOT public.wasla_can_manage_operations() THEN
    RAISE EXCEPTION 'Not authorized to manage provider publication' USING ERRCODE = '42501';
  END IF;
  IF p_is_published AND NOT p_is_active THEN
    RAISE EXCEPTION 'An inactive provider cannot be published' USING ERRCODE = '23514';
  END IF;
  UPDATE public.wasla_provider_profiles
  SET is_active = p_is_active,
      is_published = p_is_published,
      updated_at = now()
  WHERE id = p_provider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_set_provider_state(uuid,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_set_provider_state(uuid,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_can_manage_provider_catalog(p_provider_id uuid)
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
      AND sector IN ('restaurants','market')
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_can_manage_provider_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_can_manage_provider_catalog(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_get_owned_provider_profiles()
RETURNS TABLE (
  id uuid,
  business_name text,
  contact_name text,
  contact_phone text,
  city text,
  address text,
  description text,
  sector text,
  is_active boolean,
  is_published boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
  SELECT p.id,p.business_name,p.contact_name,p.contact_phone,p.city,p.address,
         p.description,p.sector,p.is_active,p.is_published,p.created_at
  FROM public.wasla_provider_profiles p
  WHERE p.owner_user_id = auth.uid()
  ORDER BY p.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.wasla_get_owned_provider_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_get_owned_provider_profiles() TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_is_active_provider()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.wasla_provider_profiles
    WHERE owner_user_id = auth.uid() AND is_active = true
  );
$function$;
REVOKE ALL ON FUNCTION public.wasla_is_active_provider() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_is_active_provider() TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.wasla_provider_profiles'::regclass AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.wasla_provider_products'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'WASLA provider catalog RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'wasla_provider_application_create_profile'
      AND tgrelid = 'public.wasla_provider_applications'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'WASLA provider approval profile trigger is missing';
  END IF;
END;
$verify$;

COMMIT;
