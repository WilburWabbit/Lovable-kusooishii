CREATE OR REPLACE FUNCTION public.v2_reallocate_costs_by_grade(p_line_item_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total_landed NUMERIC; v_total_expected_revenue NUMERIC; rec RECORD;
  grade_ratio NUMERIC[] := ARRAY[1.0, 0.8, 0.6, 0.4];
BEGIN
  SELECT quantity * landed_cost_per_unit INTO v_total_landed FROM public.purchase_line_items WHERE id = p_line_item_id;
  IF v_total_landed IS NULL OR v_total_landed = 0 THEN RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price ELSE grade_ratio[su.condition_grade::text::integer] * 100 END), 0)
  INTO v_total_expected_revenue FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
  WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL;
  IF v_total_expected_revenue = 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT su.id AS unit_id, CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price ELSE grade_ratio[su.condition_grade::text::integer] * 100 END AS expected_price
    FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
    WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL
  LOOP
    UPDATE public.stock_unit SET landed_cost = ROUND((rec.expected_price / v_total_expected_revenue) * v_total_landed, 2) WHERE id = rec.unit_id;
  END LOOP;
END;
$$;