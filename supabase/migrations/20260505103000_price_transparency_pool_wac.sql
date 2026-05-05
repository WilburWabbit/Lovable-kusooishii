-- Continuous price transparency.
-- Uses pooled weighted-average carrying value as the primary SKU cost basis,
-- preserves highest-unit exposure for operator visibility, and exposes a
-- current read model for Product 360 pricing transparency.
-- Lovable-safe: PL/pgSQL bodies use single-quoted strings, not dollar quotes.

DO '
BEGIN
  IF to_regprocedure(''public.commerce_quote_price_highest_unit_legacy(uuid,text,numeric,text)'') IS NULL THEN
    ALTER FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
      RENAME TO commerce_quote_price_highest_unit_legacy;
  END IF;
END;
';

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
  v_channel TEXT := CASE WHEN p_channel = ''website'' THEN ''web'' ELSE COALESCE(p_channel, ''web'') END;
  v_quote JSONB;
  v_breakdown JSONB;
  v_floor_contributors JSONB;
  v_target_contributors JSONB;
  v_blocking JSONB;
  v_warnings JSONB;
  v_cost_basis JSONB;
  v_pooled_carrying_value NUMERIC := 0;
  v_highest_unit_carrying_value NUMERIC := 0;
  v_unit_count INTEGER := 0;
  v_packaging_cost NUMERIC := 0;
  v_delivery_cost NUMERIC := 0;
  v_min_profit NUMERIC := 1;
  v_min_margin NUMERIC := 0.05;
  v_risk_rate NUMERIC := 0;
  v_non_fee_costs NUMERIC := 0;
  v_floor NUMERIC := 0;
  v_previous_floor NUMERIC := 0;
  v_fee RECORD;
  v_fee_base NUMERIC := 0;
  v_fee_amount NUMERIC := 0;
  v_floor_fees NUMERIC := 0;
  v_floor_fee_rate NUMERIC := 0;
  v_floor_fixed_fees NUMERIC := 0;
  v_floor_risk_reserve NUMERIC := 0;
  v_margin_uplift NUMERIC := 0;
  v_market_consensus NUMERIC := NULL;
  v_market_anchor NUMERIC := NULL;
  v_applied_market_undercut NUMERIC := 0;
  v_market_target NUMERIC := NULL;
  v_target NUMERIC := 0;
  v_ceiling NUMERIC := 0;
  v_gross_price NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_program_commission NUMERIC := 0;
  v_total_channel_fees NUMERIC := 0;
  v_fee_rate NUMERIC := 0;
  v_fixed_fee_costs NUMERIC := 0;
  v_risk_reserve NUMERIC := 0;
  v_estimated_net NUMERIC := 0;
  v_expected_margin NUMERIC := 0;
  v_expected_margin_rate NUMERIC := NULL;
  v_override_required BOOLEAN := false;
  v_target_below_floor BOOLEAN := false;
BEGIN
  v_quote := public.commerce_quote_price_highest_unit_legacy(
    p_sku_id,
    v_channel,
    p_candidate_price,
    p_sales_program_code
  );
  v_breakdown := COALESCE(v_quote->''breakdown'', ''{}''::jsonb);

  SELECT
    COALESCE(AVG(NULLIF(COALESCE(su.carrying_value, su.landed_cost, 0), 0)), 0),
    COALESCE(MAX(COALESCE(su.carrying_value, su.landed_cost, 0)), 0),
    COUNT(*)::int
  INTO v_pooled_carrying_value, v_highest_unit_carrying_value, v_unit_count
  FROM public.stock_unit su
  WHERE su.sku_id = p_sku_id
    AND COALESCE(su.v2_status::text, su.status::text) IN (''received'', ''graded'', ''listed'', ''available'', ''restocked'')
    AND COALESCE(su.v2_status::text, su.status::text) <> ''pending_receipt'';

  v_packaging_cost := COALESCE(NULLIF(v_quote->>''packaging_cost'', '''')::numeric, 0);
  v_delivery_cost := COALESCE(NULLIF(v_quote->>''delivery_cost'', '''')::numeric, 0);
  v_min_profit := COALESCE(NULLIF(v_breakdown->>''min_profit'', '''')::numeric, 1);
  v_min_margin := COALESCE(NULLIF(v_breakdown->>''min_margin'', '''')::numeric, 5) / 100;
  v_risk_rate := COALESCE(NULLIF(v_breakdown->>''risk_reserve_rate'', '''')::numeric, 0) / 100;
  v_discount := COALESCE(NULLIF(v_quote->>''discounts'', '''')::numeric, 0);
  v_program_commission := COALESCE(NULLIF(v_quote->>''program_commission'', '''')::numeric, 0);
  v_market_consensus := NULLIF(v_quote->>''market_consensus'', '''')::numeric;
  v_market_anchor := NULLIF(v_breakdown->>''pre_undercut_market_price'', '''')::numeric;
  v_applied_market_undercut := COALESCE(NULLIF(v_breakdown->>''applied_market_undercut'', '''')::numeric, 0);

  v_non_fee_costs := ROUND(v_pooled_carrying_value + v_packaging_cost + v_delivery_cost, 2);
  v_floor := GREATEST(v_non_fee_costs + v_min_profit, 0);

  FOR i IN 1..8 LOOP
    v_previous_floor := v_floor;
    v_floor_fees := 0;
    v_floor_fee_rate := 0;
    v_floor_fixed_fees := 0;

    FOR v_fee IN
      SELECT DISTINCT ON (lower(cfs.fee_name), cfs.applies_to)
        cfs.*
      FROM public.channel_fee_schedule cfs
      WHERE cfs.channel = v_channel
        AND cfs.active = true
      ORDER BY lower(cfs.fee_name), cfs.applies_to, cfs.updated_at DESC, cfs.created_at DESC
    LOOP
      v_fee_base := v_floor;
      IF v_fee.applies_to = ''sale_plus_shipping'' THEN
        v_fee_base := v_floor + v_delivery_cost;
      ELSIF v_fee.applies_to = ''sale_price_inc_vat'' THEN
        v_fee_base := v_floor * 1.2;
      END IF;

      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;

      v_floor_fees := v_floor_fees + v_fee_amount;
      v_floor_fee_rate := v_floor_fee_rate + (COALESCE(v_fee.rate_percent, 0) / 100);
      v_floor_fixed_fees := v_floor_fixed_fees + COALESCE(v_fee.fixed_amount, 0);
    END LOOP;

    v_floor_risk_reserve := v_floor * v_risk_rate;
    v_floor := ROUND(
      GREATEST(
        (v_non_fee_costs + v_floor_fees + v_floor_risk_reserve + v_min_profit)
          / GREATEST(1 - GREATEST(v_min_margin, 0), 0.05),
        0
      ),
      2
    );

    IF abs(v_floor - v_previous_floor) < 0.01 THEN
      EXIT;
    END IF;
  END LOOP;

  v_floor_fees := ROUND(v_floor_fees, 2);
  v_floor_risk_reserve := ROUND(v_floor * v_risk_rate, 2);
  v_margin_uplift := ROUND(GREATEST(v_floor - v_non_fee_costs - v_floor_fees - v_floor_risk_reserve - v_min_profit, 0), 2);

  IF v_market_anchor IS NOT NULL AND v_market_anchor > 0 THEN
    v_market_target := GREATEST(v_market_anchor - v_applied_market_undercut, 0);
    v_target := floor(v_market_target) + 0.99;
    IF v_target > v_market_target THEN
      v_target := v_target - 1;
    END IF;
    v_target := ROUND(GREATEST(v_target, 0), 2);
  ELSE
    v_target := ROUND(v_floor, 2);
  END IF;

  v_ceiling := floor(GREATEST(v_floor, COALESCE(v_market_anchor, v_floor))) + 0.99;
  IF v_ceiling < v_floor THEN
    v_ceiling := v_floor;
  END IF;

  IF v_target < v_floor THEN
    v_target_below_floor := true;
  END IF;

  IF p_candidate_price IS NOT NULL AND p_candidate_price > 0 THEN
    v_gross_price := ROUND(p_candidate_price, 2);
  ELSE
    v_gross_price := ROUND(v_target, 2);
  END IF;

  v_total_channel_fees := 0;
  v_fee_rate := 0;
  v_fixed_fee_costs := 0;

  FOR v_fee IN
    SELECT DISTINCT ON (lower(cfs.fee_name), cfs.applies_to)
      cfs.*
    FROM public.channel_fee_schedule cfs
    WHERE cfs.channel = v_channel
      AND cfs.active = true
    ORDER BY lower(cfs.fee_name), cfs.applies_to, cfs.updated_at DESC, cfs.created_at DESC
  LOOP
    v_fee_base := v_gross_price;
    IF v_fee.applies_to = ''sale_plus_shipping'' THEN
      v_fee_base := v_gross_price + v_delivery_cost;
    ELSIF v_fee.applies_to = ''sale_price_inc_vat'' THEN
      v_fee_base := v_gross_price * 1.2;
    END IF;

    v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
    IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
    IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;

    v_total_channel_fees := v_total_channel_fees + v_fee_amount;
    v_fee_rate := v_fee_rate + (COALESCE(v_fee.rate_percent, 0) / 100);
    v_fixed_fee_costs := v_fixed_fee_costs + COALESCE(v_fee.fixed_amount, 0);
  END LOOP;

  v_total_channel_fees := ROUND(v_total_channel_fees, 2);
  v_risk_reserve := ROUND(v_gross_price * v_risk_rate, 2);
  v_estimated_net := ROUND(v_gross_price - v_total_channel_fees, 2);
  v_expected_margin := ROUND(v_gross_price - v_total_channel_fees - v_risk_reserve - v_program_commission - v_non_fee_costs, 2);
  v_expected_margin_rate := CASE WHEN v_gross_price > 0 THEN ROUND(v_expected_margin / v_gross_price, 6) ELSE NULL END;

  SELECT COALESCE(jsonb_agg(to_jsonb(value)), ''[]''::jsonb)
  INTO v_blocking
  FROM jsonb_array_elements_text(COALESCE(v_quote->''blocking_reasons'', ''[]''::jsonb)) AS value
  WHERE value <> ''below_channel_net_floor'';

  v_warnings := COALESCE(v_quote->''warning_reasons'', ''[]''::jsonb);
  IF v_target_below_floor AND NOT (v_warnings ? ''market_target_below_floor'') THEN
    v_warnings := v_warnings || jsonb_build_array(''market_target_below_floor'');
  END IF;
  IF v_unit_count = 0 AND NOT (v_warnings ? ''missing_carrying_value'') THEN
    v_warnings := v_warnings || jsonb_build_array(''missing_carrying_value'');
  END IF;

  IF v_gross_price <= 0 THEN
    v_blocking := v_blocking || jsonb_build_array(''missing_price'');
    v_override_required := true;
  END IF;
  IF v_gross_price < v_floor THEN
    v_blocking := v_blocking || jsonb_build_array(''below_channel_net_floor'');
    v_override_required := true;
  END IF;

  v_cost_basis := jsonb_build_object(
    ''basis_strategy'', ''pool_wac'',
    ''pooled_carrying_value'', ROUND(v_pooled_carrying_value, 2),
    ''highest_unit_carrying_value'', ROUND(v_highest_unit_carrying_value, 2),
    ''unit_count'', v_unit_count,
    ''exposure_over_pool'', ROUND(GREATEST(v_highest_unit_carrying_value - v_pooled_carrying_value, 0), 2)
  );

  v_floor_contributors := jsonb_build_array(
    jsonb_build_object(''key'', ''pooled_carrying_value'', ''label'', ''Pooled carrying value'', ''amount'', ROUND(v_pooled_carrying_value, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''packaging_cost'', ''label'', ''Packaging'', ''amount'', ROUND(v_packaging_cost, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''delivery_cost'', ''label'', ''Delivery'', ''amount'', ROUND(v_delivery_cost, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''estimated_channel_fees'', ''label'', ''Channel and payment fees'', ''amount'', v_floor_fees, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''risk_reserve'', ''label'', ''Risk reserve'', ''amount'', v_floor_risk_reserve, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''minimum_profit'', ''label'', ''Minimum profit'', ''amount'', ROUND(v_min_profit, 2), ''kind'', ''profit''),
    jsonb_build_object(''key'', ''margin_uplift'', ''label'', ''Margin uplift'', ''amount'', v_margin_uplift, ''kind'', ''margin'')
  );

  v_target_contributors := jsonb_build_array(
    jsonb_build_object(''key'', ''market_consensus'', ''label'', ''Market consensus'', ''amount'', COALESCE(ROUND(v_market_consensus, 2), 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''condition_adjusted_market'', ''label'', ''Condition-adjusted market'', ''amount'', COALESCE(ROUND(v_market_anchor, 2), 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''channel_undercut'', ''label'', ''Channel undercut'', ''amount'', ROUND(v_applied_market_undercut * -1, 2), ''kind'', ''rule''),
    jsonb_build_object(''key'', ''target_price'', ''label'', ''Target price'', ''amount'', ROUND(v_target, 2), ''kind'', ''result''),
    jsonb_build_object(''key'', ''floor_gap'', ''label'', ''Floor comparison gap'', ''amount'', ROUND(v_target - v_floor, 2), ''kind'', ''comparison'')
  );

  RETURN v_quote
    || jsonb_build_object(
      ''gross_price'', v_gross_price,
      ''current_price'', v_gross_price,
      ''estimated_fees'', v_total_channel_fees,
      ''estimated_net'', v_estimated_net,
      ''cogs_or_carrying_value'', ROUND(v_pooled_carrying_value, 2),
      ''carrying_value'', ROUND(v_pooled_carrying_value, 2),
      ''average_carrying_value'', ROUND(v_pooled_carrying_value, 2),
      ''highest_unit_carrying_value'', ROUND(v_highest_unit_carrying_value, 2),
      ''stock_unit_count'', v_unit_count,
      ''delivery_cost'', ROUND(v_delivery_cost, 2),
      ''cost_base'', v_non_fee_costs,
      ''floor_price'', ROUND(v_floor, 2),
      ''target_price'', ROUND(v_target, 2),
      ''ceiling_price'', ROUND(GREATEST(v_ceiling, v_target, v_floor), 2),
      ''expected_gross_margin'', ROUND(v_gross_price - v_pooled_carrying_value, 2),
      ''expected_net_margin'', v_expected_margin,
      ''expected_net_margin_rate'', v_expected_margin_rate,
      ''blocking_reasons'', v_blocking,
      ''warning_reasons'', v_warnings,
      ''override_required'', v_override_required,
      ''cost_basis'', v_cost_basis,
      ''floor_contributors'', v_floor_contributors,
      ''target_contributors'', v_target_contributors,
      ''calculation_basis'', ''pool_wac_v1'',
      ''breakdown'', v_breakdown || jsonb_build_object(
        ''basis_strategy'', ''pool_wac'',
        ''carrying_value'', ROUND(v_pooled_carrying_value, 2),
        ''average_carrying_value'', ROUND(v_pooled_carrying_value, 2),
        ''highest_unit_carrying_value'', ROUND(v_highest_unit_carrying_value, 2),
        ''exposure_over_pool'', ROUND(GREATEST(v_highest_unit_carrying_value - v_pooled_carrying_value, 0), 2),
        ''packaging_cost'', ROUND(v_packaging_cost, 2),
        ''shipping_cost'', ROUND(v_delivery_cost, 2),
        ''total_fee_rate'', ROUND(v_fee_rate * 100, 2),
        ''fixed_fee_costs'', ROUND(v_fixed_fee_costs, 2),
        ''estimated_fees_at_target'', v_total_channel_fees,
        ''estimated_net_at_target'', v_estimated_net,
        ''risk_reserve'', v_risk_reserve,
        ''risk_reserve_rate'', ROUND(v_risk_rate * 100, 2),
        ''min_profit'', ROUND(v_min_profit, 2),
        ''min_margin'', ROUND(v_min_margin * 100, 2),
        ''target_floor_clamped'', 0,
        ''market_target_below_floor'', CASE WHEN v_target_below_floor THEN 1 ELSE 0 END
      )
    );
END;
';

GRANT EXECUTE ON FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_price_decision_snapshot(
  p_sku_id UUID,
  p_channel TEXT DEFAULT 'website',
  p_channel_listing_id UUID DEFAULT NULL,
  p_candidate_price NUMERIC DEFAULT NULL,
  p_sales_program_code TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_channel TEXT := CASE WHEN p_channel = ''website'' THEN ''web'' ELSE COALESCE(p_channel, ''web'') END;
  v_quote JSONB;
  v_policy_id UUID;
  v_channel_policy_id UUID;
  v_program_id UUID;
  v_snapshot_id UUID;
BEGIN
  v_quote := public.commerce_quote_price(p_sku_id, v_channel, p_candidate_price, p_sales_program_code);

  SELECT id INTO v_policy_id
  FROM public.price_policy
  WHERE policy_code = ''default'';

  SELECT id INTO v_channel_policy_id
  FROM public.channel_price_policy
  WHERE price_policy_id = v_policy_id
    AND channel = v_channel
    AND active = true
  LIMIT 1;

  IF p_sales_program_code IS NOT NULL THEN
    SELECT id INTO v_program_id
    FROM public.sales_program
    WHERE program_code = p_sales_program_code;
  END IF;

  INSERT INTO public.price_decision_snapshot (
    sku_id,
    channel_listing_id,
    price_policy_id,
    channel_price_policy_id,
    sales_program_id,
    channel,
    currency,
    candidate_price,
    current_price,
    floor_price,
    target_price,
    ceiling_price,
    market_consensus_price,
    carrying_value_basis,
    packaging_cost,
    delivery_cost,
    estimated_fees,
    estimated_program_discount,
    estimated_program_commission,
    expected_gross,
    expected_net_before_cogs,
    expected_margin_amount,
    expected_margin_rate,
    confidence_score,
    recommendation,
    blocking_reasons,
    override_required,
    inputs,
    calculation_version,
    created_by
  )
  VALUES (
    p_sku_id,
    p_channel_listing_id,
    v_policy_id,
    v_channel_policy_id,
    v_program_id,
    v_channel,
    ''GBP'',
    (v_quote->>''gross_price'')::numeric,
    (v_quote->>''gross_price'')::numeric,
    (v_quote->>''floor_price'')::numeric,
    (v_quote->>''target_price'')::numeric,
    (v_quote->>''ceiling_price'')::numeric,
    NULLIF(v_quote->>''market_consensus_price'', '''')::numeric,
    (v_quote->>''cogs_or_carrying_value'')::numeric,
    (v_quote->>''packaging_cost'')::numeric,
    (v_quote->>''delivery_cost'')::numeric,
    (v_quote->>''estimated_fees'')::numeric,
    (v_quote->>''discounts'')::numeric,
    (v_quote->>''program_commission'')::numeric,
    (v_quote->>''gross_price'')::numeric,
    (v_quote->>''estimated_net'')::numeric,
    (v_quote->>''expected_net_margin'')::numeric,
    NULLIF(v_quote->>''expected_net_margin_rate'', '''')::numeric,
    (v_quote->>''confidence_score'')::numeric,
    CASE
      WHEN (v_quote->>''override_required'')::boolean THEN ''review''
      WHEN jsonb_array_length(COALESCE(v_quote->''warning_reasons'', ''[]''::jsonb)) > 0 THEN ''review''
      ELSE ''publish''
    END,
    v_quote->''blocking_reasons'',
    (v_quote->>''override_required'')::boolean,
    v_quote,
    ''pool_wac_transparency_v1'',
    p_actor_id
  )
  RETURNING id INTO v_snapshot_id;

  IF p_channel_listing_id IS NOT NULL THEN
    UPDATE public.channel_listing
    SET current_price_decision_snapshot_id = v_snapshot_id,
        fee_adjusted_price = (v_quote->>''gross_price'')::numeric,
        estimated_fees = (v_quote->>''estimated_fees'')::numeric,
        estimated_net = (v_quote->>''estimated_net'')::numeric,
        priced_at = now()
    WHERE id = p_channel_listing_id;
  END IF;

  RETURN v_snapshot_id;
END;
';

GRANT EXECUTE ON FUNCTION public.create_price_decision_snapshot(UUID, TEXT, UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_price_transparency_current
WITH (security_invoker = true)
AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (pds.sku_id, pds.channel)
    pds.*
  FROM public.price_decision_snapshot pds
  ORDER BY pds.sku_id, pds.channel, pds.created_at DESC
),
latest_override AS (
  SELECT DISTINCT ON (po.sku_id, po.channel)
    po.*
  FROM public.price_override po
  ORDER BY po.sku_id, po.channel, po.created_at DESC
),
latest_listing AS (
  SELECT DISTINCT ON (cl.sku_id, normalized.channel)
    cl.*,
    normalized.channel AS normalized_channel
  FROM public.channel_listing cl
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN COALESCE(NULLIF(cl.channel, ''), cl.v2_channel::text, 'web') = 'website' THEN 'web'
      ELSE COALESCE(NULLIF(cl.channel, ''), cl.v2_channel::text, 'web')
    END AS channel
  ) normalized
  WHERE cl.sku_id IS NOT NULL
  ORDER BY cl.sku_id, normalized.channel,
    CASE WHEN cl.v2_status::text = 'live' THEN 0 ELSE 1 END,
    COALESCE(cl.listed_at, cl.updated_at, cl.created_at) DESC
)
SELECT
  p.id AS product_id,
  p.mpn,
  p.name AS product_name,
  s.id AS sku_id,
  s.sku_code,
  s.condition_grade,
  ls.channel,
  ll.id AS channel_listing_id,
  ll.listed_price,
  ll.v2_status AS listing_status,
  ls.id AS price_decision_snapshot_id,
  ls.current_price,
  ls.floor_price,
  ls.target_price,
  ls.ceiling_price,
  ls.market_consensus_price,
  ls.carrying_value_basis AS pooled_carrying_value,
  COALESCE((ls.inputs->'cost_basis'->>'highest_unit_carrying_value')::numeric, ls.carrying_value_basis) AS highest_unit_carrying_value,
  COALESCE((ls.inputs->'cost_basis'->>'unit_count')::integer, 0) AS stock_unit_count,
  ls.expected_margin_amount,
  ls.expected_margin_rate,
  ls.confidence_score,
  ls.recommendation,
  ls.blocking_reasons,
  ls.override_required,
  ls.inputs,
  ls.calculation_version,
  ls.created_at AS priced_at,
  lo.id AS latest_override_id,
  lo.override_type,
  lo.reason_code AS override_reason_code,
  lo.reason_note AS override_reason_note,
  lo.new_price AS override_price,
  lo.created_at AS override_at
FROM public.sku s
JOIN public.product p ON p.id = s.product_id
LEFT JOIN latest_snapshot ls ON ls.sku_id = s.id
LEFT JOIN latest_listing ll ON ll.sku_id = s.id AND ll.normalized_channel = ls.channel
LEFT JOIN latest_override lo ON lo.sku_id = s.id AND lo.channel = ls.channel;

GRANT SELECT ON public.v_price_transparency_current TO authenticated;
