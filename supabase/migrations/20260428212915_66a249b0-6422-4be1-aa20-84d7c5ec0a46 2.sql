CREATE OR REPLACE FUNCTION public.allocate_stock_units(
  p_sku_id uuid,
  p_quantity int,
  p_order_id uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_unit_ids uuid[];
  v_count int;
BEGIN
  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.has_role(v_actor, 'staff'::app_role)
     ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(id) INTO v_unit_ids
  FROM (
    SELECT id
    FROM public.stock_unit
    WHERE sku_id = p_sku_id
      AND order_id IS NULL
      AND (
        v2_status IN ('graded', 'listed', 'restocked')
        OR (v2_status IS NULL AND status IN ('available', 'received', 'graded'))
      )
    ORDER BY
      CASE v2_status
        WHEN 'listed' THEN 0
        WHEN 'graded' THEN 1
        WHEN 'restocked' THEN 2
        ELSE 3
      END,
      created_at ASC
    LIMIT p_quantity
    FOR UPDATE SKIP LOCKED
  ) sub;

  v_count := coalesce(array_length(v_unit_ids, 1), 0);

  IF v_count > 0 THEN
    UPDATE public.stock_unit
    SET status = 'closed',
        v2_status = 'sold',
        sold_at = COALESCE(sold_at, now()),
        order_id = COALESCE(p_order_id, order_id),
        updated_at = now()
    WHERE id = ANY(v_unit_ids);
  END IF;

  RETURN coalesce(v_unit_ids, ARRAY[]::uuid[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_order_line_stock_unit(
  p_order_id uuid,
  p_line_item_id uuid,
  p_sku_code text
)
RETURNS public.stock_unit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_line record;
  v_unit public.stock_unit;
  v_remaining_unallocated int;
BEGIN
  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.has_role(v_actor, 'staff'::app_role)
     ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT sol.id, sol.sales_order_id, sol.sku_id, sol.stock_unit_id, sk.sku_code
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

  IF v_line.sku_code IS DISTINCT FROM p_sku_code THEN
    RAISE EXCEPTION 'Order line SKU % does not match requested SKU %', v_line.sku_code, p_sku_code;
  END IF;

  SELECT su.*
    INTO v_unit
  FROM public.stock_unit su
  WHERE su.sku_id = v_line.sku_id
    AND su.order_id IS NULL
    AND (
      su.v2_status IN ('listed', 'graded', 'restocked')
      OR (su.v2_status IS NULL AND su.status IN ('available', 'received', 'graded'))
    )
  ORDER BY
    CASE su.v2_status
      WHEN 'listed' THEN 0
      WHEN 'graded' THEN 1
      WHEN 'restocked' THEN 2
      ELSE 3
    END,
    su.created_at ASC
  LIMIT 1
  FOR UPDATE OF su SKIP LOCKED;

  IF v_unit.id IS NULL THEN
    RAISE EXCEPTION 'No available stock units for SKU %', p_sku_code;
  END IF;

  UPDATE public.stock_unit
  SET status = 'closed',
      v2_status = 'sold',
      sold_at = COALESCE(sold_at, now()),
      order_id = p_order_id,
      updated_at = now()
  WHERE id = v_unit.id
  RETURNING * INTO v_unit;

  UPDATE public.sales_order_line
  SET stock_unit_id = v_unit.id,
      cogs = v_unit.landed_cost
  WHERE id = p_line_item_id;

  SELECT count(*)
    INTO v_remaining_unallocated
  FROM public.sales_order_line
  WHERE sales_order_id = p_order_id
    AND stock_unit_id IS NULL;

  IF v_remaining_unallocated = 0 THEN
    UPDATE public.sales_order
    SET v2_status = CASE WHEN v2_status = 'needs_allocation' THEN 'new' ELSE v2_status END,
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN v_unit;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_consume_fifo_unit(p_sku_code text)
RETURNS public.stock_unit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_unit public.stock_unit;
BEGIN
  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND NOT (
       public.has_role(v_actor, 'admin'::app_role)
       OR public.has_role(v_actor, 'staff'::app_role)
     ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT su.* INTO v_unit
  FROM public.stock_unit su
  JOIN public.sku sk ON sk.id = su.sku_id
  WHERE sk.sku_code = p_sku_code
    AND su.order_id IS NULL
    AND (
      su.v2_status IN ('listed', 'graded', 'restocked')
      OR (su.v2_status IS NULL AND su.status IN ('available', 'received', 'graded'))
    )
  ORDER BY
    CASE su.v2_status
      WHEN 'listed' THEN 0
      WHEN 'graded' THEN 1
      WHEN 'restocked' THEN 2
      ELSE 3
    END,
    su.created_at ASC
  LIMIT 1
  FOR UPDATE OF su SKIP LOCKED;

  IF v_unit.id IS NULL THEN
    RAISE EXCEPTION 'No available stock units for SKU %', p_sku_code;
  END IF;

  UPDATE public.stock_unit
  SET status = 'closed',
      v2_status = 'sold',
      sold_at = COALESCE(sold_at, now()),
      updated_at = now()
  WHERE id = v_unit.id
  RETURNING * INTO v_unit;

  RETURN v_unit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_stock_units(uuid, int, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_stock_units(uuid, int, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_stock_units(uuid, int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_stock_units(uuid, int, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) TO service_role;