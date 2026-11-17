-- WASLA merchant checkout and order fulfillment.
-- Apply after 20261120_order_lifecycle.sql, 20261121_courier_dispatch.sql,
-- and 20261122_provider_catalog.sql.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.wasla_provider_profiles') IS NULL
     OR to_regclass('public.wasla_provider_products') IS NULL
     OR to_regclass('public.wasla_notifications') IS NULL
     OR to_regprocedure('public.wasla_order_status_transition_allowed(text,text)') IS NULL
     OR to_regprocedure('public.wasla_owns_provider_profile(uuid)') IS NULL
     OR to_regprocedure('public.wasla_can_manage_operations()') IS NULL
     OR to_regprocedure('public.wasla_is_active_courier()') IS NULL THEN
    RAISE EXCEPTION 'WASLA market checkout migration prerequisites are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.orders'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'WASLA market checkout requires orders RLS';
  END IF;
END;
$preflight$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provider_id uuid
  REFERENCES public.wasla_provider_profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS delivery_lng numeric(9,6);
DO $coordinates$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.orders'::regclass
      AND conname='wasla_orders_delivery_coordinates_pair_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT wasla_orders_delivery_coordinates_pair_check
      CHECK (
        (delivery_lat IS NULL AND delivery_lng IS NULL)
        OR (
          delivery_lat IS NOT NULL
          AND delivery_lng IS NOT NULL
          AND delivery_lat BETWEEN -90 AND 90
          AND delivery_lng BETWEEN -180 AND 180
        )
      );
  END IF;
END;
$coordinates$;

CREATE INDEX IF NOT EXISTS wasla_orders_provider_status_created_idx
  ON public.orders(provider_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.wasla_market_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  provider_id uuid NOT NULL REFERENCES public.wasla_provider_profiles(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.wasla_provider_products(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wasla_market_order_items_order_product_uidx
  ON public.wasla_market_order_items(order_id,product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wasla_market_order_items_provider_order_idx
  ON public.wasla_market_order_items(provider_id,order_id);

ALTER TABLE public.wasla_market_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wasla_market_items_customer_read ON public.wasla_market_order_items;
DROP POLICY IF EXISTS wasla_market_items_provider_read ON public.wasla_market_order_items;
DROP POLICY IF EXISTS wasla_market_items_founder_read ON public.wasla_market_order_items;
CREATE POLICY wasla_market_items_customer_read
  ON public.wasla_market_order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id::text = wasla_market_order_items.order_id
      AND o.user_id = auth.uid()
  ));
CREATE POLICY wasla_market_items_provider_read
  ON public.wasla_market_order_items FOR SELECT TO authenticated
  USING (public.wasla_owns_provider_profile(provider_id));
CREATE POLICY wasla_market_items_founder_read
  ON public.wasla_market_order_items FOR SELECT TO authenticated
  USING (public.wasla_can_manage_operations());

REVOKE ALL ON TABLE public.wasla_market_order_items FROM anon,authenticated;
GRANT SELECT ON TABLE public.wasla_market_order_items TO authenticated;

DROP POLICY IF EXISTS wasla_orders_provider_read ON public.orders;
DROP POLICY IF EXISTS wasla_orders_provider_update ON public.orders;
CREATE POLICY wasla_orders_provider_read
  ON public.orders FOR SELECT TO authenticated
  USING (provider_id IS NOT NULL AND public.wasla_owns_provider_profile(provider_id));
CREATE POLICY wasla_orders_provider_update
  ON public.orders FOR UPDATE TO authenticated
  USING (provider_id IS NOT NULL AND public.wasla_owns_provider_profile(provider_id))
  WITH CHECK (provider_id IS NOT NULL AND public.wasla_owns_provider_profile(provider_id));

CREATE OR REPLACE FUNCTION public.wasla_protect_provider_order_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.provider_id IS NOT NULL
     AND current_setting('wasla.provider_order_creation',true) IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'Provider order creation must use the checkout RPC' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.provider_id IS DISTINCT FROM OLD.provider_id
     AND current_setting('wasla.provider_order_creation',true) IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION 'Provider assignment cannot be changed directly' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_protect_provider_order_assignment() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_protect_provider_assignment ON public.orders;
CREATE TRIGGER wasla_orders_protect_provider_assignment
BEFORE INSERT OR UPDATE OF provider_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_protect_provider_order_assignment();

CREATE OR REPLACE FUNCTION public.wasla_authorize_order_status_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.wasla_can_manage_operations()
       AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Customer-created orders must start as pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.wasla_can_manage_operations() THEN
    RETURN NEW;
  END IF;
  IF public.wasla_is_active_courier()
     AND (
       (OLD.status = 'assigned' AND NEW.status = 'out_for_delivery')
       OR (OLD.status = 'out_for_delivery' AND NEW.status = 'delivered')
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.provider_id IS NOT NULL
     AND public.wasla_owns_provider_profile(NEW.provider_id)
     AND (
       (OLD.status = 'pending' AND NEW.status IN ('accepted','cancelled'))
       OR (OLD.status = 'accepted' AND NEW.status IN ('preparing','cancelled'))
       OR (OLD.status = 'preparing' AND NEW.status IN ('ready_for_pickup','cancelled'))
     ) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id = auth.uid()
     AND OLD.provider_id IS NOT NULL
     AND OLD.status = 'pending'
     AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This account is not authorized to change the order status' USING ERRCODE = '42501';
END;
$function$;

DROP FUNCTION IF EXISTS public.wasla_create_market_order(uuid,jsonb,text,text,text);
CREATE OR REPLACE FUNCTION public.wasla_create_market_order(
  p_provider_id uuid,
  p_items jsonb,
  p_delivery_address text,
  p_customer_phone text,
  p_notes text DEFAULT '',
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_provider public.wasla_provider_profiles%ROWTYPE;
  v_item jsonb;
  v_product public.wasla_provider_products%ROWTYPE;
  v_product_id uuid;
  v_quantity integer;
  v_lines jsonb := '[]'::jsonb;
  v_summary text := '';
  v_total numeric(12,2) := 0;
  v_order_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before placing an order' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_address IS NULL OR length(btrim(p_delivery_address)) < 5 OR length(p_delivery_address) > 400 THEN
    RAISE EXCEPTION 'A valid delivery address is required' USING ERRCODE = '22023';
  END IF;
  IF p_customer_phone IS NULL OR length(btrim(p_customer_phone)) NOT BETWEEN 8 AND 24 THEN
    RAISE EXCEPTION 'A valid contact phone is required' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 1000 THEN
    RAISE EXCEPTION 'Order notes are too long' USING ERRCODE = '22023';
  END IF;
  IF (p_delivery_lat IS NULL) <> (p_delivery_lng IS NULL)
     OR (p_delivery_lat IS NOT NULL AND (p_delivery_lat NOT BETWEEN -90 AND 90 OR p_delivery_lng NOT BETWEEN -180 AND 180)) THEN
    RAISE EXCEPTION 'Delivery coordinates must be a valid latitude/longitude pair' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cart items must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Choose between 1 and 30 order lines' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT value->>'product_id')
    FROM jsonb_array_elements(p_items)
  ) THEN
    RAISE EXCEPTION 'Duplicate products must be combined into one cart line' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.wasla_provider_profiles
  WHERE id = p_provider_id
    AND sector IN ('restaurants','market')
    AND is_active = true
    AND is_published = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This merchant is not currently accepting orders' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS item(value) LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid product or quantity in cart' USING ERRCODE = '22023';
    END;
    IF v_quantity IS NULL OR v_quantity NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'Each product quantity must be between 1 and 50' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_product
    FROM public.wasla_provider_products
    WHERE id = v_product_id
      AND provider_id = p_provider_id
      AND is_available = true
    FOR UPDATE;
    IF NOT FOUND OR v_product.stock_quantity < v_quantity THEN
      RAISE EXCEPTION 'A selected product is unavailable or has insufficient stock' USING ERRCODE = '23514';
    END IF;

    UPDATE public.wasla_provider_products
    SET stock_quantity = stock_quantity - v_quantity,
        updated_at = now()
    WHERE id = v_product_id;

    v_total := v_total + (v_product.price * v_quantity);
    v_summary := v_summary || format('%s × %s = %s ج.م؛ ',v_product.name,v_quantity,(v_product.price*v_quantity));
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,
      'name',v_product.name,
      'unit_price',v_product.price,
      'quantity',v_quantity
    ));
  END LOOP;

  PERFORM set_config('wasla.provider_order_creation','authorized',true);
  INSERT INTO public.orders(user_id,sector,details,status,provider_id,delivery_lat,delivery_lng)
  VALUES (
    auth.uid(),
    v_provider.sector,
    'النشاط: ' || v_provider.business_name || E'\n' ||
    'عنوان التوصيل: ' || btrim(p_delivery_address) || E'\n' ||
    'هاتف العميل: ' || btrim(p_customer_phone) || E'\n' ||
    'المنتجات: ' || v_summary || E'\n' ||
    'الإجمالي: ' || v_total::text || ' ج.م' || E'\n' ||
    'الدفع: نقدًا عند الاستلام' || E'\n' ||
    'ملاحظات: ' || coalesce(btrim(p_notes),'') ||
    CASE WHEN p_delivery_lat IS NOT NULL THEN E'\\nالموقع الجغرافي: ' || p_delivery_lat::text || ',' || p_delivery_lng::text ELSE '' END,
    'pending',
    p_provider_id,
    p_delivery_lat,
    p_delivery_lng
  )
  RETURNING id::text INTO v_order_id;
  PERFORM set_config('wasla.provider_order_creation','',true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) AS item(value) LOOP
    INSERT INTO public.wasla_market_order_items(order_id,provider_id,product_id,item_name,unit_price,quantity)
    VALUES (
      v_order_id,p_provider_id,(v_item->>'product_id')::uuid,
      v_item->>'name',(v_item->>'unit_price')::numeric,(v_item->>'quantity')::integer
    );
  END LOOP;
  RETURN v_order_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_create_market_order(uuid,jsonb,text,text,text,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_create_market_order(uuid,jsonb,text,text,text,double precision,double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_update_market_order_status(
  p_order_id text,
  p_next_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id::text = p_order_id
    AND provider_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.wasla_owns_provider_profile(v_order.provider_id) THEN
    RAISE EXCEPTION 'Order not found or not owned by this merchant' USING ERRCODE = '42501';
  END IF;
  IF p_next_status NOT IN ('accepted','preparing','ready_for_pickup','cancelled')
     OR NOT public.wasla_order_status_transition_allowed(v_order.status::text,p_next_status) THEN
    RAISE EXCEPTION 'Invalid merchant order status transition' USING ERRCODE = '23514';
  END IF;
  UPDATE public.orders SET status = p_next_status WHERE id::text = p_order_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_update_market_order_status(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_update_market_order_status(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_cancel_market_order(p_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before cancelling an order' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id::text = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM auth.uid()
     OR v_order.provider_id IS NULL OR v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Only your pending merchant orders can be cancelled' USING ERRCODE = '42501';
  END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id::text = p_order_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_cancel_market_order(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wasla_cancel_market_order(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wasla_restore_market_stock_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status = 'cancelled'
     AND NEW.provider_id IS NOT NULL THEN
    UPDATE public.wasla_provider_products product
    SET stock_quantity = product.stock_quantity + item.quantity,
        updated_at = now()
    FROM public.wasla_market_order_items item
    WHERE item.order_id = NEW.id::text
      AND item.product_id = product.id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_restore_market_stock_on_cancel() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_restore_market_stock ON public.orders;
CREATE TRIGGER wasla_orders_restore_market_stock
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_restore_market_stock_on_cancel();

CREATE OR REPLACE FUNCTION public.wasla_notify_market_order_provider()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog,public,auth
AS $function$
DECLARE
  v_owner uuid;
  v_title text;
  v_body text;
BEGIN
  IF NEW.provider_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_user_id INTO v_owner
  FROM public.wasla_provider_profiles WHERE id = NEW.provider_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_title := 'طلب جديد من وصلة';
    v_body := 'استلم نشاطك طلبًا جديدًا. افتح لوحة التاجر لمراجعته.';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
    v_title := 'تم إلغاء طلب';
    v_body := 'تم إلغاء الطلب ' || coalesce(NEW.tracking_code,NEW.id::text) || ' وإعادة الكميات المحجوزة إلى المخزون.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.wasla_notifications(user_id,title,body,type,order_id)
  VALUES (v_owner,v_title,v_body,'market_order_' || NEW.status,NEW.id::text);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.wasla_notify_market_order_provider() FROM PUBLIC;
DROP TRIGGER IF EXISTS wasla_orders_notify_market_provider ON public.orders;
CREATE TRIGGER wasla_orders_notify_market_provider
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.wasla_notify_market_order_provider();

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='orders'
      AND policyname='wasla_orders_provider_read' AND cmd='SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='orders'
      AND policyname='wasla_orders_provider_update' AND cmd='UPDATE'
  ) THEN
    RAISE EXCEPTION 'WASLA market order RLS policies are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='wasla_orders_protect_provider_assignment'
      AND tgrelid='public.orders'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'WASLA provider assignment protection trigger is missing';
  END IF;
END;
$verify$;

COMMIT;
