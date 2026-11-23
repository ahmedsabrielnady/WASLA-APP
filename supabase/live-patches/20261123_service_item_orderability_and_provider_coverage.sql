-- Provider-backed service availability.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.
-- Only plumbing and electrical work are currently backed by the active
-- non-test technician. All other catalogue items remain visible but cannot
-- be ordered until an approved active provider is onboarded.

ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS public_orderable boolean NOT NULL DEFAULT false;

UPDATE public.service_items
SET public_orderable = (id IN (4, 7));

ALTER TABLE public.service_items
  DROP CONSTRAINT IF EXISTS service_items_public_orderable_requires_active;

ALTER TABLE public.service_items
  ADD CONSTRAINT service_items_public_orderable_requires_active
  CHECK (NOT public_orderable OR active);

CREATE OR REPLACE FUNCTION public.place_order_v2(
  p_sector text,
  p_item_id integer,
  p_address text,
  p_notes text DEFAULT NULL,
  p_source text DEFAULT 'web',
  p_idempotency_key text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS TABLE(out_order_id uuid, out_ref text, out_deposit_egp integer, out_price_egp integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.service_items%rowtype;
  v_order public.orders%rowtype;
  v_source text;
  v_price integer;
  v_deposit integer;
  v_recent integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'سجل الدخول أولًا' USING errcode='28000';
  END IF;

  IF p_sector IS NULL OR p_sector NOT IN ('maintenance','car') THEN
    RAISE EXCEPTION 'هذا القطاع غير متاح للطلب العام حاليًا' USING errcode='22023';
  END IF;

  IF p_address IS NULL OR char_length(trim(p_address)) < 4 OR char_length(trim(p_address)) > 255 THEN
    RAISE EXCEPTION 'العنوان غير صالح' USING errcode='22023';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 500 THEN
    RAISE EXCEPTION 'الملاحظات أطول من المسموح' USING errcode='22023';
  END IF;
  IF p_idempotency_key IS NOT NULL AND
     (char_length(trim(p_idempotency_key)) < 8 OR char_length(trim(p_idempotency_key)) > 128) THEN
    RAISE EXCEPTION 'مفتاح منع التكرار غير صالح' USING errcode='22023';
  END IF;

  v_source := CASE WHEN p_source IN ('web','app','whatsapp','walkin') THEN p_source ELSE 'web' END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders
    WHERE customer_id=v_uid AND idempotency_key=trim(p_idempotency_key);
    IF FOUND THEN
      RETURN QUERY SELECT v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;
      RETURN;
    END IF;
  END IF;

  IF NOT (
    EXISTS(SELECT 1 FROM public.consents WHERE user_id=v_uid AND kind='terms')
    AND EXISTS(SELECT 1 FROM public.consents WHERE user_id=v_uid AND kind='privacy')
  ) THEN
    RAISE EXCEPTION 'لازم توافق على الشروط وسياسة الخصوصية الأول' USING errcode='42501';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.orders
  WHERE customer_id=v_uid AND created_at > pg_catalog.now()-interval '10 minutes';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'طلبات كتير في وقت قصير، استنى شوية' USING errcode='53400';
  END IF;

  SELECT * INTO v_item
  FROM public.service_items
  WHERE id=p_item_id
    AND sector=p_sector
    AND active=true
    AND public_orderable=true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخدمة دي مش متاحة للطلب حاليًا' USING errcode='22023';
  END IF;

  v_price := v_item.price_egp;
  v_deposit := CASE WHEN coalesce(v_price,0)>300
                    THEN floor(v_price*0.25+0.5)::integer ELSE 0 END;

  INSERT INTO public.orders(
    customer_id,sector,item_id,address,notes,price_egp,deposit_egp,source,
    lat,lng,idempotency_key
  ) VALUES (
    v_uid,p_sector,p_item_id,trim(p_address),nullif(trim(coalesce(p_notes,'')),''),
    v_price,v_deposit,v_source,p_lat,p_lng,nullif(trim(coalesce(p_idempotency_key,'')),'')
  )
  RETURNING * INTO v_order;

  INSERT INTO public.order_events(order_id,actor_id,from_status,to_status,note)
  VALUES(v_order.id,v_uid,null,'new','تم استلام الطلب');

  RETURN QUERY SELECT v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;

EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders
    WHERE customer_id=v_uid AND idempotency_key=trim(p_idempotency_key);
    IF FOUND THEN
      RETURN QUERY SELECT v_order.id,v_order.ref,v_order.deposit_egp,v_order.price_egp;
      RETURN;
    END IF;
  END IF;
  RAISE;
END;
$function$;
