CREATE OR REPLACE FUNCTION public.allocate_order_line_stock_unit_by_uid(
  p_order_id uuid,
  p_line_item_id uuid,
  p_unit_uid text
)
RETURNS stock_unit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_line record;
  v_unit public.stock_unit;
  v_line_sku record;
  v_remaining_unallocated int;
  v_before jsonb;
  v_after jsonb;
  v_allocation jsonb;
BEGIN
  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.has_role(v_actor, 'staff'::app_role)
     ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT sol.id, sol.sales_order_id, sol.sku_id, sol.stock_unit_id, sk.sku_code, sk.mpn
    INTO v_line
  FROM public.sales_order_line sol
  JOIN public.sku sk ON sk.id = sol.sku_id
  WHERE sol.id = p_line_item_id
    AND sol.sales_order_id = p_order_id
  FOR UPDATE OF sol;

  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Order line % was not found on order %', p_line_item_id, p_order_id;
  END IF;

  IF v_line.stock_unit_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order line % is already allocated', p_line_item_id;
  END IF;

  SELECT su.*
    INTO v_unit
  FROM public.stock_unit su
  WHERE su.uid = p_unit_uid
    AND su.order_id IS NULL
    AND (
      su.v2_status IN ('listed', 'graded', 'restocked')
      OR (su.v2_status IS NULL AND su.status IN ('available', 'received', 'graded'))
    )
  FOR UPDATE OF su SKIP LOCKED;

  IF v_unit.id IS NULL THEN
    RAISE EXCEPTION 'Stock unit % is not available for allocation (already allocated, sold, or non-saleable status)', p_unit_uid;
  END IF;

  v_before := to_jsonb(v_line);

  IF v_unit.sku_id IS DISTINCT FROM v_line.sku_id THEN
    SELECT id, sku_code, mpn
      INTO v_line_sku
    FROM public.sku
    WHERE id = v_unit.sku_id;

    IF v_line_sku.id IS NULL THEN
      RAISE EXCEPTION 'Stock unit % has no SKU record', p_unit_uid;
    END IF;

    IF v_line_sku.mpn IS DISTINCT FROM v_line.mpn THEN
      RAISE EXCEPTION 'Cannot allocate unit %: MPN mismatch (line=%, unit=%)',
        p_unit_uid, v_line.mpn, v_line_sku.mpn;
    END IF;

    UPDATE public.sales_order_line
    SET sku_id = v_unit.sku_id
    WHERE id = p_line_item_id;
  END IF;

  SELECT public.allocate_stock_for_order_line(p_line_item_id, v_unit.id, v_actor)
    INTO v_allocation;

  IF COALESCE(v_allocation->>'status', '') <> 'allocated' THEN
    RAISE EXCEPTION 'Stock unit % could not be allocated to order line %', p_unit_uid, p_line_item_id;
  END IF;

  SELECT *
    INTO v_unit
  FROM public.stock_unit
  WHERE id = (v_allocation->>'selected_stock_unit_id')::uuid;

  SELECT count(*)
    INTO v_remaining_unallocated
  FROM public.sales_order_line
  WHERE sales_order_id = p_order_id
    AND stock_unit_id IS NULL;

  IF v_remaining_unallocated = 0 THEN
    UPDATE public.sales_order
    SET v2_status = CASE
                      WHEN v2_status = 'needs_allocation' THEN 'awaiting_shipment'
                      ELSE v2_status
                    END,
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  PERFORM public.refresh_order_line_economics(p_order_id);

  v_after := jsonb_build_object(
    'stock_unit', to_jsonb(v_unit),
    'allocation', v_allocation
  );

  INSERT INTO public.audit_event (
    entity_type, entity_id, trigger_type, actor_type, actor_id,
    source_system, before_json, after_json,
    input_json
  )
  VALUES (
    'sales_order_line', p_line_item_id, 'manual_allocation', 'user', v_actor,
    'admin_v2', v_before, v_after,
    jsonb_build_object('unit_uid', p_unit_uid, 'order_id', p_order_id)
  );

  RETURN v_unit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.allocate_order_line_stock_unit_by_uid(uuid, uuid, text)
  TO authenticated, service_role;
