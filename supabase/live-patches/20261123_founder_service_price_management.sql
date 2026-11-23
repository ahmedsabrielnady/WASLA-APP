-- Founder-only service price management with immutable change history.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.

CREATE TABLE IF NOT EXISTS public.service_item_price_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_item_id integer NOT NULL REFERENCES public.service_items(id) ON DELETE RESTRICT,
  changed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  old_price_egp integer,
  new_price_egp integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_item_price_audit_item_created_idx
  ON public.service_item_price_audit(service_item_id, created_at DESC);

ALTER TABLE public.service_item_price_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_item_price_audit FROM anon, public;
GRANT SELECT ON public.service_item_price_audit TO authenticated;

DROP POLICY IF EXISTS service_item_price_audit_admin_read ON public.service_item_price_audit;
CREATE POLICY service_item_price_audit_admin_read
  ON public.service_item_price_audit FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS services_staff_read ON public.service_items;
CREATE POLICY services_staff_read
  ON public.service_items FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.admin_update_service_item_price(
  p_item_id integer,
  p_price integer
)
RETURNS TABLE(out_item_id integer, out_price_egp integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_old_price integer;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'هذه العملية مخصصة للمؤسس فقط' USING errcode = '42501';
  END IF;

  IF p_item_id IS NULL OR (p_price IS NOT NULL AND (p_price < 0 OR p_price > 10000000)) THEN
    RAISE EXCEPTION 'السعر غير صالح' USING errcode = '22023';
  END IF;

  SELECT si.price_egp INTO v_old_price
  FROM public.service_items si WHERE si.id = p_item_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخدمة غير موجودة' USING errcode = 'P0002';
  END IF;

  IF v_old_price IS DISTINCT FROM p_price THEN
    UPDATE public.service_items SET price_egp = p_price WHERE id = p_item_id;
    INSERT INTO public.service_item_price_audit(
      service_item_id, changed_by, old_price_egp, new_price_egp
    ) VALUES (p_item_id, v_uid, v_old_price, p_price);
  END IF;

  RETURN QUERY SELECT p_item_id, p_price;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_service_item_price(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_service_item_price(integer, integer) TO authenticated, service_role;
