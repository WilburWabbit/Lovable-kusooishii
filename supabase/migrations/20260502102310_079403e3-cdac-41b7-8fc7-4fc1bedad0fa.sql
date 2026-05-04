-- 1. Patch allocate_stock_for_order_line to advance legacy status alongside v2_status
CREATE OR REPLACE FUNCTION public.allocate_stock_for_order_line(p_sales_order_line_id uuid, p_requested_stock_unit_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS '
DECLARE
  v_line public.sales_order_line%ROWTYPE;
  v_unit public.stock_unit%ROWTYPE;
  v_method TEXT;
  v_allocation_id UUID;
  v_cost_event_id UUID;
  v_cogs NUMERIC;
BEGIN
  SELECT * INTO v_line
  FROM public.sales_order_line
  WHERE id = p_sales_order_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order_line % not found'', p_sales_order_line_id;
  END IF;

  IF v_line.stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM public.stock_unit WHERE id = v_line.stock_unit_id FOR UPDATE;
    v_method := ''specific_unit'';
  ELSIF p_requested_stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM public.stock_unit
    WHERE id = p_requested_stock_unit_id
      AND sku_id = v_line.sku_id
    FOR UPDATE;
    v_method := ''specific_unit'';
  ELSE
    SELECT su.* INTO v_unit
    FROM public.stock_unit su
    WHERE su.sku_id = v_line.sku_id
      AND su.condition_grade::text IN (''1'', ''2'', ''3'', ''4'', ''5'')
      AND COALESCE(su.v2_status::text, su.status::text) IN (''listed'', ''graded'', ''available'', ''restocked'')
    ORDER BY COALESCE(su.listed_at, su.created_at), su.created_at, su.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    v_method := ''fifo_fallback'';
  END IF;

  IF v_unit.id IS NULL THEN
    UPDATE public.sales_order_line
    SET economics_status = ''needs_allocation'',
        costing_method = COALESCE(costing_method, ''manual_exception'')
    WHERE id = p_sales_order_line_id;

    INSERT INTO public.reconciliation_case (
      case_type,
      severity,
      sales_order_id,
      sales_order_line_id,
      related_entity_type,
      related_entity_id,
      suspected_root_cause,
      recommended_action,
      evidence
    )
    VALUES (
      ''unallocated_order_line'',
      ''high'',
      v_line.sales_order_id,
      v_line.id,
      ''sales_order_line'',
      v_line.id,
      ''No eligible stock unit was available for allocation.'',
      ''Open the order line, allocate a saleable stock unit, then refresh order economics.'',
      jsonb_build_object(''sku_id'', v_line.sku_id)
    );

    RETURN jsonb_build_object(
      ''sales_order_line_id'', p_sales_order_line_id,
      ''allocation_method'', ''manual_exception'',
      ''status'', ''needs_allocation''
    );
  END IF;

  v_cogs := COALESCE(v_unit.carrying_value, v_unit.landed_cost, 0);

  INSERT INTO public.stock_allocation (
    sales_order_id,
    sales_order_line_id,
    sku_id,
    requested_stock_unit_id,
    selected_stock_unit_id,
    allocation_method,
    allocation_source,
    idempotency_key,
    status,
    actor_id,
    allocated_at
  )
  VALUES (
    v_line.sales_order_id,
    v_line.id,
    v_line.sku_id,
    p_requested_stock_unit_id,
    v_unit.id,
    v_method,
    ''domain_rpc'',
    ''sale_line:'' || v_line.id::text,
    ''allocated'',
    p_actor_id,
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET selected_stock_unit_id = EXCLUDED.selected_stock_unit_id,
      allocation_method = EXCLUDED.allocation_method,
      status = ''allocated'',
      updated_at = now()
  RETURNING id INTO v_allocation_id;

  UPDATE public.stock_unit
  SET v2_status = ''sold'',
      status = ''allocated'',
      sold_at = COALESCE(sold_at, now()),
      order_id = v_line.sales_order_id
  WHERE id = v_unit.id;

  UPDATE public.sales_order_line
  SET stock_unit_id = v_unit.id,
      cogs = v_cogs,
      cogs_amount = v_cogs,
      cogs_source_unit_id = v_unit.id,
      costing_method = v_method,
      economics_status = ''final''
  WHERE id = v_line.id;

  INSERT INTO public.stock_cost_event (
    stock_unit_id,
    sales_order_id,
    sales_order_line_id,
    stock_allocation_id,
    event_type,
    amount,
    currency,
    costing_method,
    carrying_value_before,
    carrying_value_after,
    source,
    idempotency_key,
    metadata,
    event_at
  )
  VALUES (
    v_unit.id,
    v_line.sales_order_id,
    v_line.id,
    v_allocation_id,
    ''sale_cogs'',
    v_cogs,
    ''GBP'',
    v_method,
    v_cogs,
    0,
    ''domain_rpc'',
    ''sale_cogs:'' || v_line.id::text,
    jsonb_build_object(''requested_stock_unit_id'', p_requested_stock_unit_id),
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      stock_unit_id = EXCLUDED.stock_unit_id
  RETURNING id INTO v_cost_event_id;

  RETURN jsonb_build_object(
    ''sales_order_line_id'', v_line.id,
    ''selected_stock_unit_id'', v_unit.id,
    ''allocation_method'', v_method,
    ''cogs_amount'', v_cogs,
    ''cost_event_id'', v_cost_event_id,
    ''stock_allocation_id'', v_allocation_id,
    ''status'', ''allocated''
  );
END;
';

-- 2. Patch product_detail_offers so the storefront stock predicate matches the allocation predicate
CREATE OR REPLACE FUNCTION public.product_detail_offers(p_mpn text)
 RETURNS TABLE(sku_id uuid, sku_code text, condition_grade text, price numeric, stock_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS '
  SELECT
    s.id AS sku_id, s.sku_code, s.condition_grade::text, s.price,
    COUNT(su.id) AS stock_count
  FROM product p
  JOIN sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN channel_listing cl ON cl.sku_id = s.id AND cl.channel = ''web'' AND cl.offer_status = ''PUBLISHED''
  JOIN stock_unit su ON su.sku_id = s.id
    AND COALESCE(su.v2_status::text, su.status::text) IN (''listed'', ''graded'', ''available'', ''restocked'')
  WHERE p.mpn = p_mpn AND p.status = ''active''
  GROUP BY s.id, s.sku_code, s.condition_grade, s.price
  ORDER BY s.condition_grade::text;
';

-- 3. Backfill: any unit already sold (v2_status='sold' + linked to an order) should not still be 'available'
UPDATE public.stock_unit
SET status = 'allocated'
WHERE v2_status = 'sold'
  AND status = 'available'
  AND order_id IS NOT NULL;