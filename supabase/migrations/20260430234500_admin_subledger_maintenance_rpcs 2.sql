-- Admin maintenance helpers for subledger-owned allocation and SKU cost rollups.
-- Lovable SQL runner note: keep PL/pgSQL bodies single-quoted, not dollar-quoted.

CREATE OR REPLACE FUNCTION public.release_stock_allocation_for_order_line(
  p_sales_order_line_id UUID,
  p_reason TEXT DEFAULT 'admin_maintenance'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_line public.sales_order_line%ROWTYPE;
  v_stock_unit_id UUID;
  v_released INTEGER := 0;
  v_reversal_amount NUMERIC := 0;
BEGIN
  SELECT * INTO v_line
  FROM public.sales_order_line
  WHERE id = p_sales_order_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order_line % not found'', p_sales_order_line_id;
  END IF;

  v_stock_unit_id := v_line.stock_unit_id;
  v_reversal_amount := COALESCE(v_line.cogs_amount, v_line.cogs, 0);

  UPDATE public.stock_allocation
  SET status = ''void'',
      failure_reason = COALESCE(p_reason, ''admin_maintenance''),
      requested_stock_unit_id = CASE WHEN requested_stock_unit_id = v_stock_unit_id THEN NULL ELSE requested_stock_unit_id END,
      selected_stock_unit_id = CASE WHEN selected_stock_unit_id = v_stock_unit_id THEN NULL ELSE selected_stock_unit_id END,
      released_at = now(),
      updated_at = now()
  WHERE sales_order_line_id = p_sales_order_line_id
    AND status IN (''pending'', ''allocated'');

  GET DIAGNOSTICS v_released = ROW_COUNT;

  IF v_stock_unit_id IS NOT NULL AND v_reversal_amount <> 0 THEN
    INSERT INTO public.stock_cost_event (
      stock_unit_id,
      sales_order_id,
      sales_order_line_id,
      event_type,
      amount,
      currency,
      costing_method,
      source,
      idempotency_key,
      metadata,
      event_at
    )
    VALUES (
      v_stock_unit_id,
      v_line.sales_order_id,
      v_line.id,
      ''manual_correction'',
      -ABS(v_reversal_amount),
      ''GBP'',
      COALESCE(v_line.costing_method, ''manual_exception''),
      ''admin_maintenance_rpc'',
      ''release_cogs:'' || v_line.id::text,
      jsonb_build_object(''reason'', COALESCE(p_reason, ''admin_maintenance''), ''released_stock_unit_id'', v_stock_unit_id),
      now()
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET amount = EXCLUDED.amount,
        metadata = EXCLUDED.metadata;
  END IF;

  UPDATE public.sales_order_line
  SET stock_unit_id = NULL,
      cogs = NULL,
      cogs_amount = NULL,
      cogs_source_unit_id = NULL,
      costing_method = ''manual_exception'',
      gross_margin_amount = NULL,
      net_margin_amount = NULL,
      net_margin_rate = NULL,
      economics_status = ''needs_allocation''
  WHERE id = p_sales_order_line_id;

  IF v_stock_unit_id IS NOT NULL THEN
    UPDATE public.stock_unit
    SET order_id = NULL,
        v2_status = CASE WHEN v2_status::text = ''sold'' THEN ''graded'' ELSE v2_status END,
        sold_at = CASE WHEN v2_status::text = ''sold'' THEN NULL ELSE sold_at END
    WHERE id = v_stock_unit_id
      AND order_id = v_line.sales_order_id;
  END IF;

  PERFORM public.refresh_order_line_economics(v_line.sales_order_id);

  RETURN jsonb_build_object(
    ''sales_order_line_id'', p_sales_order_line_id,
    ''released_stock_unit_id'', v_stock_unit_id,
    ''released_allocations'', v_released,
    ''status'', ''released''
  );
END;
';

CREATE OR REPLACE FUNCTION public.refresh_sku_cost_rollups(p_sku_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH target_skus AS (
    SELECT id
    FROM public.sku
    WHERE p_sku_id IS NULL OR id = p_sku_id
  ),
  stats AS (
    SELECT
      su.sku_id,
      ROUND(AVG(COALESCE(su.carrying_value, su.landed_cost)), 2) AS avg_cost,
      ROUND(MIN(COALESCE(su.carrying_value, su.landed_cost)), 2) AS min_cost,
      ROUND(MAX(COALESCE(su.carrying_value, su.landed_cost)), 2) AS max_cost
    FROM public.stock_unit su
    JOIN target_skus ts ON ts.id = su.sku_id
    WHERE COALESCE(su.carrying_value, su.landed_cost) IS NOT NULL
      AND COALESCE(su.carrying_value, su.landed_cost) > 0
      AND COALESCE(su.v2_status::text, su.status::text) IN (''graded'', ''listed'', ''available'', ''restocked'')
    GROUP BY su.sku_id
  ),
  rollups AS (
    SELECT
      ts.id AS sku_id,
      st.avg_cost,
      CASE
        WHEN st.min_cost IS NULL THEN NULL
        WHEN st.min_cost = st.max_cost THEN ''GBP '' || st.min_cost::text
        ELSE ''GBP '' || st.min_cost::text || ''-'' || st.max_cost::text
      END AS cost_range
    FROM target_skus ts
    LEFT JOIN stats st ON st.sku_id = ts.id
  )
  UPDATE public.sku sk
  SET avg_cost = rollups.avg_cost,
      cost_range = rollups.cost_range
  FROM rollups
  WHERE sk.id = rollups.sku_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.release_stock_allocation_for_order_line(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_stock_allocation_for_order_line(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_sku_cost_rollups(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sku_cost_rollups(UUID) TO service_role;

COMMENT ON FUNCTION public.release_stock_allocation_for_order_line(UUID, TEXT) IS
  'Releases a sale-line stock allocation through the costing subledger and marks the line for reallocation.';
COMMENT ON FUNCTION public.refresh_sku_cost_rollups(UUID) IS
  'Refreshes deprecated SKU avg_cost/cost_range compatibility fields from saleable stock-unit carrying values.';
