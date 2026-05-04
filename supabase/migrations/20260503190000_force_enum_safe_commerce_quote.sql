-- Force-replace the canonical pricing function with an enum-safe condition grade extraction.
-- Lovable-safe: PL/pgSQL bodies use single-quoted strings, not dollar quotes.

CREATE OR REPLACE FUNCTION public.commerce_quote_price(
  p_sku_id UUID,
  p_channel TEXT DEFAULT 'website',
  p_candidate_price NUMERIC DEFAULT NULL,
  p_sales_program_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_policy_id UUID;
  v_channel_policy_id UUID;
  v_program public.sales_program%ROWTYPE;
  v_channel TEXT := CASE WHEN p_channel = ''website'' THEN ''web'' ELSE COALESCE(p_channel, ''web'') END;
  v_sku_code TEXT;
  v_sku_price NUMERIC;
  v_sku_sale_price NUMERIC;
  v_legacy_market_price NUMERIC;
  v_condition_grade INTEGER;
  v_mpn TEXT;
  v_weight_kg NUMERIC := 0;
  v_length_cm NUMERIC;
  v_width_cm NUMERIC;
  v_height_cm NUMERIC;
  v_has_dimensions BOOLEAN := false;
  v_carrying_value NUMERIC := 0;
  v_average_carrying_value NUMERIC := 0;
  v_stock_unit_count INTEGER := 0;
  v_min_profit NUMERIC := 1;
  v_min_margin NUMERIC := 0.15;
  v_packaging_cost NUMERIC := 0;
  v_risk_reserve_rate NUMERIC := 0;
  v_risk_rate NUMERIC := 0;
  v_condition_multiplier NUMERIC := 1;
  v_active_tier TEXT := ''tier_1'';
  v_prefer_evri_threshold NUMERIC := 1.0;
  v_shipping_cost NUMERIC := 0;
  v_default_shipping_cost NUMERIC := 0;
  v_ebay_shipping_cost NUMERIC := NULL;
  v_fee RECORD;
  v_effective_fee_rate NUMERIC := 0;
  v_fixed_fee_costs NUMERIC := 0;
  v_total_channel_fees NUMERIC := 0;
  v_fee_amount NUMERIC := 0;
  v_fee_base NUMERIC := 0;
  v_fee_count INTEGER := 0;
  v_cost_base NUMERIC := 0;
  v_denominator NUMERIC := 0;
  v_floor NUMERIC := 0;
  v_needed_price NUMERIC := 0;
  v_required_ex_vat NUMERIC := 0;
  v_net_fees NUMERIC := 0;
  v_risk_reserve NUMERIC := 0;
  v_market_consensus NUMERIC := NULL;
  v_market_confidence NUMERIC := 0;
  v_market_channel TEXT := NULL;
  v_market_snapshot RECORD;
  v_pre_undercut_market_price NUMERIC := NULL;
  v_min_undercut_pct NUMERIC := 0;
  v_min_undercut_amount NUMERIC := 0;
  v_max_undercut_pct NUMERIC := NULL;
  v_max_undercut_amount NUMERIC := NULL;
  v_minimum_undercut NUMERIC := 0;
  v_maximum_undercut NUMERIC := NULL;
  v_applied_market_undercut NUMERIC := 0;
  v_target_floor_clamped BOOLEAN := false;
  v_ceiling_basis NUMERIC := 0;
  v_ceiling NUMERIC := 0;
  v_target NUMERIC := 0;
  v_gross_price NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_commission NUMERIC := 0;
  v_estimated_net NUMERIC := 0;
  v_expected_margin NUMERIC := 0;
  v_expected_margin_rate NUMERIC;
  v_confidence NUMERIC := 0;
  v_blocking JSONB := ''[]''::jsonb;
  v_warnings JSONB := ''[]''::jsonb;
  v_override_required BOOLEAN := false;
BEGIN
  SELECT sk.sku_code,
         sk.price,
         sk.sale_price,
         sk.market_price,
         NULLIF(regexp_replace(sk.condition_grade::text, ''[^0-9]'', '''', ''g''), '''')::integer,
         sk.mpn,
         COALESCE(pr.weight_kg, 0),
         pr.length_cm,
         pr.width_cm,
         pr.height_cm
  INTO v_sku_code,
       v_sku_price,
       v_sku_sale_price,
       v_legacy_market_price,
       v_condition_grade,
       v_mpn,
       v_weight_kg,
       v_length_cm,
       v_width_cm,
       v_height_cm
  FROM public.sku sk
  LEFT JOIN public.product pr ON pr.id = sk.product_id
  WHERE sk.id = p_sku_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''SKU % not found'', p_sku_id;
  END IF;

  v_has_dimensions := v_length_cm IS NOT NULL AND v_width_cm IS NOT NULL AND v_height_cm IS NOT NULL;

  SELECT id INTO v_policy_id
  FROM public.price_policy
  WHERE policy_code = ''default''
  LIMIT 1;

  SELECT id INTO v_channel_policy_id
  FROM public.channel_price_policy
  WHERE price_policy_id = v_policy_id
    AND channel = v_channel
    AND active = true
  LIMIT 1;

  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''minimum_profit_amount''), 1)
  INTO v_min_profit;
  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''minimum_margin_rate''), 0.15)
  INTO v_min_margin;
  IF v_min_margin > 1 THEN v_min_margin := v_min_margin / 100; END IF;
  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''packaging_cost''), 0)
  INTO v_packaging_cost;
  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''risk_reserve_rate''), 0)
  INTO v_risk_reserve_rate;
  v_risk_rate := CASE WHEN v_risk_reserve_rate > 1 THEN v_risk_reserve_rate / 100 ELSE v_risk_reserve_rate END;
  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''condition_multiplier_'' || COALESCE(v_condition_grade, 0)::text), 1)
  INTO v_condition_multiplier;
  SELECT ''tier_'' || COALESCE((SELECT value::int FROM public.selling_cost_defaults WHERE key = ''evri_active_tier''), 1)::text
  INTO v_active_tier;
  SELECT COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = ''shipping_prefer_evri_threshold''), 1.0)
  INTO v_prefer_evri_threshold;

  SELECT
    COALESCE(MAX(COALESCE(su.carrying_value, su.landed_cost, 0)), 0),
    COALESCE(AVG(NULLIF(COALESCE(su.carrying_value, su.landed_cost, 0), 0)), 0),
    COUNT(*)::int
  INTO v_carrying_value, v_average_carrying_value, v_stock_unit_count
  FROM public.stock_unit su
  WHERE su.sku_id = p_sku_id
    AND COALESCE(su.v2_status::text, su.status::text) IN (''received'', ''graded'', ''listed'', ''available'', ''restocked'')
    AND COALESCE(su.v2_status::text, su.status::text) <> ''pending_receipt'';

  IF v_carrying_value <= 0 THEN
    v_warnings := v_warnings || jsonb_build_array(''missing_carrying_value'');
  END IF;

  SELECT COALESCE(market_undercut_min_pct, 0),
         COALESCE(market_undercut_min_amount, 0),
         market_undercut_max_pct,
         market_undercut_max_amount
  INTO v_min_undercut_pct, v_min_undercut_amount, v_max_undercut_pct, v_max_undercut_amount
  FROM public.channel_pricing_config
  WHERE channel = v_channel
  LIMIT 1;

  v_min_undercut_pct := CASE WHEN v_min_undercut_pct > 1 THEN v_min_undercut_pct / 100 ELSE COALESCE(v_min_undercut_pct, 0) END;
  IF v_max_undercut_pct IS NOT NULL AND v_max_undercut_pct > 1 THEN
    v_max_undercut_pct := v_max_undercut_pct / 100;
  END IF;

  SELECT COALESCE((
    SELECT srt.cost
    FROM public.shipping_rate_table srt
    WHERE srt.channel = ''default''
      AND srt.tier = v_active_tier
      AND srt.destination = ''domestic''
      AND srt.active = true
      AND srt.max_weight_kg >= COALESCE(v_weight_kg, 0)
      AND (NOT v_has_dimensions OR (
        (srt.max_length_cm IS NULL OR srt.max_length_cm >= v_length_cm)
        AND (srt.max_width_cm IS NULL OR srt.max_width_cm >= v_width_cm)
        AND (srt.max_depth_cm IS NULL OR srt.max_depth_cm >= v_height_cm)
      ))
    ORDER BY srt.cost ASC
    LIMIT 1
  ), 0)
  INTO v_default_shipping_cost;

  IF v_channel = ''ebay'' THEN
    SELECT (
      SELECT srt.cost
      FROM public.shipping_rate_table srt
      WHERE srt.channel = ''ebay''
        AND srt.destination = ''domestic''
        AND srt.active = true
        AND srt.max_weight_kg >= COALESCE(v_weight_kg, 0)
        AND (NOT v_has_dimensions OR (
          (srt.max_length_cm IS NULL OR srt.max_length_cm >= v_length_cm)
          AND (srt.max_width_cm IS NULL OR srt.max_width_cm >= v_width_cm)
          AND (srt.max_depth_cm IS NULL OR srt.max_depth_cm >= v_height_cm)
        ))
      ORDER BY srt.cost ASC
      LIMIT 1
    )
    INTO v_ebay_shipping_cost;
  END IF;

  v_shipping_cost := COALESCE(v_default_shipping_cost, 0);
  IF v_channel = ''ebay'' AND v_ebay_shipping_cost IS NOT NULL AND (v_shipping_cost - v_ebay_shipping_cost) > v_prefer_evri_threshold THEN
    v_shipping_cost := v_ebay_shipping_cost;
  END IF;

  FOR v_fee IN
    SELECT *
    FROM public.channel_fee_schedule cfs
    WHERE cfs.channel = v_channel
      AND cfs.active = true
  LOOP
    v_fee_count := v_fee_count + 1;
    IF v_fee.applies_to = ''sale_plus_shipping'' THEN
      v_effective_fee_rate := v_effective_fee_rate + COALESCE(v_fee.rate_percent, 0) / 100;
      v_fixed_fee_costs := v_fixed_fee_costs + COALESCE(v_fee.fixed_amount, 0) + (v_shipping_cost * COALESCE(v_fee.rate_percent, 0) / 100);
    ELSIF v_fee.applies_to = ''sale_price_inc_vat'' THEN
      v_effective_fee_rate := v_effective_fee_rate + (COALESCE(v_fee.rate_percent, 0) / 100) * 1.2;
      v_fixed_fee_costs := v_fixed_fee_costs + COALESCE(v_fee.fixed_amount, 0);
    ELSE
      v_effective_fee_rate := v_effective_fee_rate + COALESCE(v_fee.rate_percent, 0) / 100;
      v_fixed_fee_costs := v_fixed_fee_costs + COALESCE(v_fee.fixed_amount, 0);
    END IF;
  END LOOP;

  v_cost_base := ROUND(v_carrying_value + v_packaging_cost + v_shipping_cost, 2);
  v_denominator := GREATEST(1 - GREATEST(v_min_margin, 0.01) - v_effective_fee_rate - v_risk_rate, 0.05);
  v_floor := ROUND((1.2 * (v_cost_base + v_min_profit + (v_fixed_fee_costs / 1.2)) / v_denominator), 2);

  FOR i IN 1..5 LOOP
    v_total_channel_fees := 0;
    FOR v_fee IN
      SELECT *
      FROM public.channel_fee_schedule cfs
      WHERE cfs.channel = v_channel
        AND cfs.active = true
    LOOP
      v_fee_base := v_floor;
      IF v_fee.applies_to = ''sale_plus_shipping'' THEN
        v_fee_base := v_floor + v_shipping_cost;
      ELSIF v_fee.applies_to = ''sale_price_inc_vat'' THEN
        v_fee_base := v_floor * 1.2;
      END IF;
      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
      v_total_channel_fees := v_total_channel_fees + v_fee_amount;
    END LOOP;
    v_net_fees := v_total_channel_fees / 1.2;
    v_risk_reserve := (v_floor / 1.2) * v_risk_rate;
    v_required_ex_vat := v_cost_base + v_min_profit + v_net_fees + v_risk_reserve;
    v_needed_price := 1.2 * v_required_ex_vat / (1 - GREATEST(v_min_margin, 0.01));
    IF v_needed_price <= v_floor + 0.01 THEN
      EXIT;
    END IF;
    v_floor := ROUND(v_needed_price, 2);
  END LOOP;

  SELECT row_data.* INTO v_market_snapshot
  FROM (
    SELECT mps.price, mps.confidence_score, mps.channel, mps.captured_at
    FROM public.market_price_snapshot mps
    WHERE mps.sku_id = p_sku_id
      AND mps.channel IN (v_channel, ''all'', ''legacy'')
    ORDER BY CASE WHEN mps.channel = v_channel THEN 1 WHEN mps.channel = ''all'' THEN 2 ELSE 3 END,
             mps.captured_at DESC
    LIMIT 1
  ) row_data;

  IF FOUND AND v_market_snapshot.price IS NOT NULL THEN
    v_market_consensus := v_market_snapshot.price;
    v_market_confidence := COALESCE(v_market_snapshot.confidence_score, 0.5);
    v_market_channel := v_market_snapshot.channel;
  ELSIF v_legacy_market_price IS NOT NULL AND v_legacy_market_price > 0 THEN
    v_market_consensus := v_legacy_market_price;
    v_market_confidence := 0.45;
    v_market_channel := ''sku_legacy'';
  ELSIF v_mpn IS NOT NULL THEN
    SELECT bec.current_value
    INTO v_market_consensus
    FROM public.brickeconomy_collection bec
    WHERE bec.item_number IN (v_mpn, regexp_replace(v_mpn, ''-[0-9]+$'', ''''))
      AND bec.current_value IS NOT NULL
    ORDER BY CASE WHEN bec.item_number = v_mpn THEN 0 ELSE 1 END, bec.synced_at DESC
    LIMIT 1;
    IF v_market_consensus IS NOT NULL THEN
      v_market_confidence := 0.7;
      v_market_channel := ''brickeconomy_cache'';
    END IF;
  END IF;

  v_ceiling_basis := GREATEST(v_floor, COALESCE(v_market_consensus, v_floor));
  v_ceiling := floor(v_ceiling_basis) + 0.99;
  IF v_ceiling < v_floor THEN
    v_ceiling := v_floor;
  END IF;

  IF v_market_consensus IS NOT NULL THEN
    v_pre_undercut_market_price := v_market_consensus * v_condition_multiplier;
    v_minimum_undercut := GREATEST(v_pre_undercut_market_price * COALESCE(v_min_undercut_pct, 0), COALESCE(v_min_undercut_amount, 0));
    IF v_max_undercut_pct IS NOT NULL OR v_max_undercut_amount IS NOT NULL THEN
      v_maximum_undercut := GREATEST(
        COALESCE(v_pre_undercut_market_price * v_max_undercut_pct, 0),
        COALESCE(v_max_undercut_amount, 0)
      );
      IF v_maximum_undercut <= 0 THEN v_maximum_undercut := NULL; END IF;
    END IF;
    v_applied_market_undercut := CASE
      WHEN v_maximum_undercut IS NULL THEN v_minimum_undercut
      ELSE LEAST(v_minimum_undercut, v_maximum_undercut)
    END;
    v_target := floor(v_pre_undercut_market_price - v_applied_market_undercut) + 0.99;
    IF v_target > (v_pre_undercut_market_price - v_applied_market_undercut) THEN
      v_target := v_target - 1;
    END IF;
    IF v_target < v_floor THEN
      v_target := v_floor;
      v_target_floor_clamped := true;
    END IF;
  ELSE
    v_target := v_floor;
    v_warnings := v_warnings || jsonb_build_array(''missing_market_consensus'');
  END IF;

  IF p_candidate_price IS NOT NULL AND p_candidate_price > 0 THEN
    v_gross_price := ROUND(p_candidate_price, 2);
  ELSE
    v_gross_price := ROUND(v_target, 2);
  END IF;

  IF p_sales_program_code IS NOT NULL THEN
    SELECT * INTO v_program
    FROM public.sales_program
    WHERE program_code = p_sales_program_code
      AND status = ''active'';
    IF FOUND THEN
      v_discount := ROUND(v_gross_price * COALESCE(v_program.default_discount_rate, 0), 2);
      v_commission := ROUND(GREATEST(v_gross_price - v_discount, 0) * COALESCE(v_program.default_commission_rate, 0), 2);
    END IF;
  END IF;

  v_total_channel_fees := 0;
  FOR v_fee IN
    SELECT *
    FROM public.channel_fee_schedule cfs
    WHERE cfs.channel = v_channel
      AND cfs.active = true
  LOOP
    v_fee_base := v_gross_price;
    IF v_fee.applies_to = ''sale_plus_shipping'' THEN
      v_fee_base := v_gross_price + v_shipping_cost;
    ELSIF v_fee.applies_to = ''sale_price_inc_vat'' THEN
      v_fee_base := v_gross_price * 1.2;
    END IF;
    v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
    IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
    IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
    v_total_channel_fees := v_total_channel_fees + v_fee_amount;
  END LOOP;

  v_total_channel_fees := ROUND(v_total_channel_fees, 2);
  v_estimated_net := ROUND(v_gross_price - v_total_channel_fees, 2);
  v_expected_margin := ROUND(v_estimated_net - v_commission - v_carrying_value, 2);
  v_expected_margin_rate := CASE WHEN v_gross_price > 0 THEN ROUND(v_expected_margin / v_gross_price, 6) ELSE NULL END;

  IF v_gross_price <= 0 THEN
    v_blocking := v_blocking || jsonb_build_array(''missing_price'');
    v_override_required := true;
  END IF;
  IF v_gross_price < v_floor THEN
    v_blocking := v_blocking || jsonb_build_array(''below_channel_net_floor'');
    v_override_required := true;
  END IF;

  IF v_carrying_value > 0 THEN v_confidence := v_confidence + 0.30; END IF;
  IF v_market_confidence > 0 THEN v_confidence := v_confidence + LEAST(v_market_confidence, 1) * 0.40; END IF;
  IF v_has_dimensions THEN v_confidence := v_confidence + 0.15; END IF;
  IF v_fee_count > 0 THEN v_confidence := v_confidence + 0.15; END IF;
  v_confidence := ROUND(LEAST(v_confidence, 1), 2);

  RETURN jsonb_build_object(
    ''sku_id'', p_sku_id,
    ''sku_code'', v_sku_code,
    ''channel'', v_channel,
    ''gross_price'', v_gross_price,
    ''current_price'', v_gross_price,
    ''ex_vat_revenue'', ROUND(v_gross_price / 1.2, 2),
    ''discounts'', v_discount,
    ''fee_components'', jsonb_build_object(
      ''estimated_fees'', v_total_channel_fees,
      ''fee_rate'', v_effective_fee_rate,
      ''fixed_fee_amount'', v_fixed_fee_costs
    ),
    ''estimated_fees'', v_total_channel_fees,
    ''estimated_net'', v_estimated_net,
    ''cogs_or_carrying_value'', ROUND(v_carrying_value, 2),
    ''carrying_value'', ROUND(v_carrying_value, 2),
    ''average_carrying_value'', ROUND(v_average_carrying_value, 2),
    ''stock_unit_count'', v_stock_unit_count,
    ''program_commission'', v_commission,
    ''packaging_cost'', ROUND(v_packaging_cost, 2),
    ''delivery_cost'', ROUND(v_shipping_cost, 2),
    ''cost_base'', ROUND(v_cost_base, 2),
    ''floor_price'', ROUND(v_floor, 2),
    ''target_price'', ROUND(v_target, 2),
    ''ceiling_price'', ROUND(GREATEST(v_ceiling, v_target, v_floor), 2),
    ''market_consensus'', CASE WHEN v_market_consensus IS NULL THEN NULL ELSE ROUND(v_market_consensus, 2) END,
    ''market_consensus_price'', CASE WHEN v_market_consensus IS NULL THEN NULL ELSE ROUND(v_market_consensus, 2) END,
    ''market_channel'', v_market_channel,
    ''condition_multiplier'', v_condition_multiplier,
    ''expected_gross_margin'', ROUND(v_gross_price - v_carrying_value, 2),
    ''expected_net_margin'', v_expected_margin,
    ''expected_net_margin_rate'', v_expected_margin_rate,
    ''confidence'', v_confidence,
    ''confidence_score'', v_confidence,
    ''blocking_reasons'', v_blocking,
    ''warning_reasons'', v_warnings,
    ''override_required'', v_override_required,
    ''breakdown'', jsonb_build_object(
      ''carrying_value'', ROUND(v_carrying_value, 2),
      ''average_carrying_value'', ROUND(v_average_carrying_value, 2),
      ''packaging_cost'', ROUND(v_packaging_cost, 2),
      ''shipping_cost'', ROUND(v_shipping_cost, 2),
      ''total_fee_rate'', ROUND(v_effective_fee_rate * 100, 2),
      ''fixed_fee_costs'', ROUND(v_fixed_fee_costs, 2),
      ''estimated_fees_at_target'', v_total_channel_fees,
      ''estimated_net_at_target'', v_estimated_net,
      ''risk_reserve_rate'', ROUND(v_risk_rate * 100, 2),
      ''min_profit'', v_min_profit,
      ''min_margin'', ROUND(v_min_margin * 100, 2),
      ''market_confidence'', ROUND(v_market_confidence, 2),
      ''pre_undercut_market_price'', COALESCE(ROUND(v_pre_undercut_market_price, 2), 0),
      ''market_undercut_min_pct'', ROUND(COALESCE(v_min_undercut_pct, 0) * 100, 2),
      ''market_undercut_min_amount'', COALESCE(v_min_undercut_amount, 0),
      ''market_undercut_max_pct'', ROUND(COALESCE(v_max_undercut_pct, 0) * 100, 2),
      ''market_undercut_max_amount'', COALESCE(v_max_undercut_amount, 0),
      ''applied_market_undercut'', ROUND(v_applied_market_undercut, 2),
      ''target_floor_clamped'', CASE WHEN v_target_floor_clamped THEN 1 ELSE 0 END
    )
  );
END;
';

DO '
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(''public.commerce_quote_price(uuid,text,numeric,text)''::regprocedure)
  INTO v_definition;

  IF v_definition ~ ''condition_grade::(int|integer)'' THEN
    RAISE EXCEPTION ''commerce_quote_price still contains a direct condition_grade integer cast'';
  END IF;
END;
';
