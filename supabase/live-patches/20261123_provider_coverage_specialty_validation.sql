-- Specialty validation for founder-managed provider/service coverage.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.

CREATE OR REPLACE FUNCTION public.admin_set_provider_service_coverage(
  p_provider_id uuid,
  p_service_item_id integer,
  p_active boolean DEFAULT true
)
RETURNS TABLE(out_coverage_id uuid,out_active boolean,out_public_orderable boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_provider public.providers%rowtype;
  v_item public.service_items%rowtype;
  v_coverage_id uuid;
  v_specialty text;
  v_service_name text;
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
      OR (v_item.sector='education' AND v_provider.kind='teacher')
      OR (v_item.sector='delivery' AND v_provider.kind='courier')
      OR (v_item.sector='food' AND v_provider.kind IN ('merchant','courier'))
    ) THEN
      RAISE EXCEPTION 'نوع مقدم الخدمة غير مناسب لهذا القطاع' USING errcode='22023';
    END IF;

    v_specialty := lower(coalesce(v_provider.specialty,''));
    v_service_name := lower(coalesce(v_item.name,''));

    IF v_item.sector='car'
      AND v_specialty !~ '(سيارات|ميكانيكا|ميكانيكي|بطاريات|إطارات|عفشة|كهرباء سيارات)' THEN
      RAISE EXCEPTION 'خدمات السيارات تحتاج فنيًا متخصصًا في السيارات' USING errcode='22023';
    END IF;
    IF v_item.sector='maintenance' AND v_service_name LIKE '%سباك%'
      AND v_specialty !~ '(سباك|سباكة)' THEN
      RAISE EXCEPTION 'الخدمة تحتاج فني سباكة' USING errcode='22023';
    END IF;
    IF v_item.sector='maintenance' AND v_service_name LIKE '%كهربائي%'
      AND v_specialty !~ '(كهرباء|كهربائي)' THEN
      RAISE EXCEPTION 'الخدمة تحتاج فني كهرباء' USING errcode='22023';
    END IF;
    IF v_item.sector='maintenance' AND v_service_name LIKE '%تنظيف%'
      AND v_specialty !~ '(تنظيف|نظافة)' THEN
      RAISE EXCEPTION 'الخدمة تحتاج مقدم خدمة متخصصًا في التنظيف' USING errcode='22023';
    END IF;
    IF v_item.sector='maintenance' AND v_service_name LIKE '%حشرات%'
      AND v_specialty !~ '(حشرات|مكافحة)' THEN
      RAISE EXCEPTION 'الخدمة تحتاج مقدم خدمة متخصصًا في مكافحة الحشرات' USING errcode='22023';
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
