-- Provider-to-service coverage with database-enforced assignment.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.
-- An item becomes public-orderable only while at least one approved, active,
-- non-test provider has an active explicit coverage link.

CREATE TABLE IF NOT EXISTS public.provider_service_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_item_id integer NOT NULL REFERENCES public.service_items(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, service_item_id)
);

CREATE INDEX IF NOT EXISTS provider_service_coverage_item_active_idx
  ON public.provider_service_coverage(service_item_id, active);
CREATE INDEX IF NOT EXISTS provider_service_coverage_provider_active_idx
  ON public.provider_service_coverage(provider_id, active);

ALTER TABLE public.provider_service_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_service_coverage FROM anon, public;
GRANT SELECT ON public.provider_service_coverage TO authenticated;

CREATE POLICY provider_service_coverage_admin_read
  ON public.provider_service_coverage FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id=(SELECT auth.uid()) AND p.role='admin')
  );

CREATE POLICY provider_service_coverage_provider_read
  ON public.provider_service_coverage FOR SELECT TO authenticated
  USING (provider_id=public.current_provider_id());

CREATE OR REPLACE FUNCTION public.sync_service_item_orderability_from_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_item_id integer;
BEGIN
  IF tg_op='DELETE' THEN v_item_id:=old.service_item_id;
  ELSE v_item_id:=new.service_item_id; END IF;

  UPDATE public.service_items si
  SET public_orderable=(
    si.active=true AND si.sector IN ('maintenance','car')
    AND EXISTS (
      SELECT 1 FROM public.provider_service_coverage c
      JOIN public.providers p ON p.id=c.provider_id
      WHERE c.service_item_id=si.id AND c.active=true
        AND p.approved=true AND p.active=true AND p.is_test=false
    )
  )
  WHERE si.id=v_item_id;

  IF tg_op='DELETE' THEN RETURN old; END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_service_item_orderability_from_provider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.service_items si
  SET public_orderable=(
    si.active=true AND si.sector IN ('maintenance','car')
    AND EXISTS (
      SELECT 1 FROM public.provider_service_coverage c
      JOIN public.providers p ON p.id=c.provider_id
      WHERE c.service_item_id=si.id AND c.active=true
        AND p.approved=true AND p.active=true AND p.is_test=false
    )
  )
  WHERE EXISTS (
    SELECT 1 FROM public.provider_service_coverage c
    WHERE c.provider_id=new.id AND c.service_item_id=si.id
  );
  RETURN new;
END;
$function$;

CREATE TRIGGER provider_service_coverage_sync_orderability
AFTER INSERT OR UPDATE OR DELETE ON public.provider_service_coverage
FOR EACH ROW EXECUTE FUNCTION public.sync_service_item_orderability_from_coverage();

CREATE TRIGGER providers_sync_service_orderability
AFTER UPDATE OF approved, active, is_test ON public.providers
FOR EACH ROW EXECUTE FUNCTION public.sync_service_item_orderability_from_provider();

CREATE OR REPLACE FUNCTION public.admin_set_provider_service_coverage(
  p_provider_id uuid, p_service_item_id integer, p_active boolean DEFAULT true
)
RETURNS TABLE(out_coverage_id uuid,out_active boolean,out_public_orderable boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_provider public.providers%rowtype;
  v_item public.service_items%rowtype;
  v_coverage_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=v_uid AND role='admin'
  ) THEN
    RAISE EXCEPTION 'هذه العملية مخصصة للمؤسس فقط' USING errcode='42501';
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id=p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مقدم الخدمة غير موجود' USING errcode='P0002'; END IF;

  SELECT * INTO v_item FROM public.service_items WHERE id=p_service_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الخدمة غير موجودة' USING errcode='P0002'; END IF;

  IF coalesce(p_active,true) THEN
    IF NOT v_provider.approved OR NOT v_provider.active OR v_provider.is_test THEN
      RAISE EXCEPTION 'لا يمكن ربط خدمة بمقدم غير معتمد أو غير نشط أو تجريبي' USING errcode='42501';
    END IF;
    IF NOT v_item.active THEN
      RAISE EXCEPTION 'لا يمكن ربط خدمة مخفية من الكتالوج' USING errcode='22023';
    END IF;

    IF NOT (
      (v_item.sector IN ('maintenance','car') AND v_provider.kind='technician')
      OR (v_item.sector='clinic' AND v_provider.kind='doctor')
      OR (v_item.sector='nursing' AND v_provider.kind IN ('doctor','technician'))
      OR (v_item.sector='education' AND v_provider.kind='teacher')
      OR (v_item.sector='delivery' AND v_provider.kind='courier')
      OR (v_item.sector='food' AND v_provider.kind IN ('merchant','courier'))
    ) THEN
      RAISE EXCEPTION 'نوع مقدم الخدمة غير مناسب لهذا القطاع' USING errcode='22023';
    END IF;

    INSERT INTO public.provider_service_coverage(
      provider_id,service_item_id,active,created_by,updated_by
    ) VALUES (p_provider_id,p_service_item_id,true,v_uid,v_uid)
    ON CONFLICT(provider_id,service_item_id)
    DO UPDATE SET active=true,updated_by=v_uid,updated_at=now()
    RETURNING id INTO v_coverage_id;
  ELSE
    UPDATE public.provider_service_coverage
    SET active=false,updated_by=v_uid,updated_at=now()
    WHERE provider_id=p_provider_id AND service_item_id=p_service_item_id
    RETURNING id INTO v_coverage_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ربط الخدمة غير موجود' USING errcode='P0002'; END IF;
  END IF;

  RETURN QUERY SELECT v_coverage_id,
    EXISTS(SELECT 1 FROM public.provider_service_coverage c WHERE c.id=v_coverage_id AND c.active),
    si.public_orderable
  FROM public.service_items si WHERE si.id=p_service_item_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_provider_service_coverage(uuid,integer,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_coverage(uuid,integer,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_service_item_orderability_from_coverage() FROM public, anon;
REVOKE ALL ON FUNCTION public.sync_service_item_orderability_from_provider() FROM public, anon;

-- Seed only the plumbing/electrical services supported by the active technician.
INSERT INTO public.provider_service_coverage(provider_id,service_item_id,active,created_by,updated_by)
SELECT p.id,si.id,true,
  '1b3c8754-1065-4623-a238-2708d17a7023'::uuid,
  '1b3c8754-1065-4623-a238-2708d17a7023'::uuid
FROM public.providers p
JOIN public.service_items si ON si.id IN (4,7)
WHERE p.id='d52a8987-5193-4b88-ba2f-6848990e4b87'
ON CONFLICT(provider_id,service_item_id)
DO UPDATE SET active=true,updated_at=now();

-- Assignment must match the exact service item coverage, not merely provider kind.
CREATE OR REPLACE FUNCTION public.assign_order_v2(p_order uuid,p_provider uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_provider public.providers%rowtype;
  v_kind_ok boolean;
BEGIN
  IF NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'غير مصرح' USING errcode='42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود' USING errcode='P0002'; END IF;

  SELECT * INTO v_provider FROM public.providers
  WHERE id=p_provider AND approved=true AND active=true AND is_test=false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'مقدم الخدمة غير معتمد أو غير نشط أو تجريبي' USING errcode='42501';
  END IF;

  v_kind_ok := CASE v_order.sector
    WHEN 'nursing' THEN v_provider.kind IN ('doctor','technician')
    WHEN 'clinic' THEN v_provider.kind='doctor'
    WHEN 'maintenance' THEN v_provider.kind='technician'
    WHEN 'car' THEN v_provider.kind='technician'
    WHEN 'education' THEN v_provider.kind='teacher'
    WHEN 'delivery' THEN v_provider.kind='courier'
    WHEN 'food' THEN v_provider.kind IN ('merchant','courier')
    ELSE false
  END;
  IF NOT v_kind_ok THEN
    RAISE EXCEPTION 'نوع مقدم الخدمة غير مناسب للقطاع' USING errcode='22023';
  END IF;

  IF v_order.item_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.provider_service_coverage c
    WHERE c.provider_id=p_provider
      AND c.service_item_id=v_order.item_id
      AND c.active=true
  ) THEN
    RAISE EXCEPTION 'مقدم الخدمة غير مرتبط بهذه الخدمة تحديدًا' USING errcode='42501';
  END IF;

  IF v_order.provider_id IS NOT NULL THEN
    IF v_order.provider_id=p_provider THEN RETURN; END IF;
    RAISE EXCEPTION 'الطلب مسند بالفعل إلى مقدم خدمة آخر' USING errcode='22023';
  END IF;
  IF v_order.status NOT IN ('new','confirmed') THEN
    RAISE EXCEPTION 'لا يمكن إسناد طلب في حالة %',v_order.status USING errcode='22023';
  END IF;

  UPDATE public.orders SET provider_id=p_provider,status='confirmed',updated_at=now()
  WHERE id=p_order;

  INSERT INTO public.order_events(order_id,actor_id,from_status,to_status,note)
  VALUES(p_order,(SELECT auth.uid()),v_order.status,'confirmed',
    'تم إسناد الطلب إلى '||v_provider.display_name);
END;
$function$;
