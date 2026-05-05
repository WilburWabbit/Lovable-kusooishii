-- Fix VAT-aware risk reserve percent regression.
DO '
BEGIN
  IF to_regprocedure(''public.commerce_quote_price_pool_wac_no_vat(uuid,text,numeric,text)'') IS NULL THEN
    ALTER FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
      RENAME TO commerce_quote_price_pool_wac_no_vat;
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
  v_blocking JSONB;
  v_warnings JSONB;
  v_floor_contributors JSONB;
  v_target_contributors JSONB;
  v_fee RECORD;
  v_fee_base NUMERIC := 0;
  v_fee_amount NUMERIC := 0;
  v_vat_rate_percent NUMERIC := 20;
  v_vat_multiplier NUMERIC := 1.2;
  v_cost_base NUMERIC := 0;
  v_pooled_carrying_value NUMERIC := 0;
  v_packaging_cost NUMERIC := 0;
  v_delivery_cost NUMERIC := 0;
  v_min_profit NUMERIC := 1;
  v_min_margin NUMERIC := 0.05;
  v_risk_rate NUMERIC := 0;
  v_program_commission NUMERIC := 0;
  v_mpn TEXT := NULL;
  v_base_mpn TEXT := NULL;
  v_product_brickeconomy_id TEXT := NULL;
  v_brickeconomy_rrp NUMERIC := NULL;
  v_brickeconomy_rrp_currency TEXT := NULL;
  v_condition_multiplier NUMERIC := 1;
  v_condition_adjusted_rrp NUMERIC := NULL;
  v_market_consensus NUMERIC := NULL;
  v_market_confidence NUMERIC := 0.5;
  v_market_anchor NUMERIC := NULL;
  v_applied_market_undercut NUMERIC := 0;
  v_min_undercut_pct NUMERIC := 0;
  v_min_undercut_amount NUMERIC := 0;
  v_max_undercut_pct NUMERIC := NULL;
  v_max_undercut_amount NUMERIC := NULL;
  v_minimum_undercut NUMERIC := 0;
  v_maximum_undercut NUMERIC := NULL;
  v_market_gap NUMERIC := 0;
  v_market_gap_ratio NUMERIC := 0;
  v_market_weight NUMERIC := 0;
  v_market_weighted_undercut NUMERIC := 0;
  v_market_target NUMERIC := NULL;
  v_floor NUMERIC := 0;
  v_previous_floor NUMERIC := 0;
  v_floor_fees_gross NUMERIC := 0;
  v_floor_fees_net NUMERIC := 0;
  v_floor_fee_input_vat NUMERIC := 0;
  v_floor_net_receipts NUMERIC := 0;
  v_floor_output_vat NUMERIC := 0;
  v_floor_risk_reserve NUMERIC := 0;
  v_margin_uplift NUMERIC := 0;
  v_target NUMERIC := 0;
  v_target_net_receipts NUMERIC := 0;
  v_target_output_vat NUMERIC := 0;
  v_target_fees_gross NUMERIC := 0;
  v_target_fees_net NUMERIC := 0;
  v_target_net_position NUMERIC := 0;
  v_ceiling NUMERIC := 0;
  v_gross_price NUMERIC := 0;
  v_total_channel_fees_gross NUMERIC := 0;
  v_total_channel_fees_net NUMERIC := 0;
  v_channel_fee_input_vat NUMERIC := 0;
  v_net_sale_receipts NUMERIC := 0;
  v_output_vat NUMERIC := 0;
  v_risk_reserve NUMERIC := 0;
  v_estimated_cash_after_fees NUMERIC := 0;
  v_estimated_net_after_vat NUMERIC := 0;
  v_expected_margin NUMERIC := 0;
  v_expected_margin_rate NUMERIC := NULL;
  v_override_required BOOLEAN := false;
  v_target_floor_clamped BOOLEAN := false;
  v_raw_min_margin NUMERIC := NULL;
  v_raw_risk_rate NUMERIC := NULL;
BEGIN
  v_quote := public.commerce_quote_price_pool_wac_no_vat(
    p_sku_id,
    v_channel,
    p_candidate_price,
    p_sales_program_code
  );
  v_breakdown := COALESCE(v_quote->''breakdown'', ''{}''::jsonb);
  v_warnings := COALESCE(v_quote->''warning_reasons'', ''[]''::jsonb);

  SELECT COALESCE((
    SELECT vr.rate_percent
    FROM public.vat_rate vr
    WHERE vr.active = true
      AND vr.rate_percent > 0
    ORDER BY CASE WHEN abs(vr.rate_percent - 20) < 0.001 THEN 0 ELSE 1 END,
      vr.rate_percent DESC,
      vr.synced_at DESC
    LIMIT 1
  ), 20)
  INTO v_vat_rate_percent;
  v_vat_multiplier := 1 + (v_vat_rate_percent / 100);

  v_pooled_carrying_value := COALESCE(NULLIF(v_quote->>''carrying_value'', '''')::numeric, 0);
  v_cost_base := COALESCE(NULLIF(v_quote->>''cost_base'', '''')::numeric, v_pooled_carrying_value);
  v_packaging_cost := COALESCE(NULLIF(v_quote->>''packaging_cost'', '''')::numeric, 0);
  v_delivery_cost := COALESCE(NULLIF(v_quote->>''delivery_cost'', '''')::numeric, 0);
  v_min_profit := COALESCE(NULLIF(v_breakdown->>''min_profit'', '''')::numeric, 1);
  v_raw_min_margin := NULLIF(v_breakdown->>''min_margin'', '''')::numeric;
  v_raw_risk_rate := NULLIF(v_breakdown->>''risk_reserve_rate'', '''')::numeric;
  v_min_margin := CASE
    WHEN v_raw_min_margin IS NULL THEN 0.05
    WHEN v_raw_min_margin > 1 THEN v_raw_min_margin / 100
    ELSE v_raw_min_margin
  END;
  v_risk_rate := GREATEST(COALESCE(v_raw_risk_rate, 0), 0) / 100;
  v_program_commission := COALESCE(NULLIF(v_quote->>''program_commission'', '''')::numeric, 0);
  v_condition_multiplier := COALESCE(NULLIF(v_quote->>''condition_multiplier'', '''')::numeric, NULLIF(v_breakdown->>''condition_multiplier'', '''')::numeric, 1);
  v_market_consensus := NULLIF(v_quote->>''market_consensus'', '''')::numeric;
  v_market_confidence := COALESCE(NULLIF(v_quote->>''confidence_score'', '''')::numeric, NULLIF(v_quote->>''confidence'', '''')::numeric, 0.5);
  v_market_confidence := CASE
    WHEN v_market_confidence > 1 THEN v_market_confidence / 100
    ELSE v_market_confidence
  END;
  v_market_confidence := LEAST(1, GREATEST(0, COALESCE(v_market_confidence, 0.5)));
  v_market_anchor := NULLIF(v_breakdown->>''pre_undercut_market_price'', '''')::numeric;
  v_applied_market_undercut := COALESCE(NULLIF(v_breakdown->>''applied_market_undercut'', '''')::numeric, 0);

  SELECT
    s.mpn,
    regexp_replace(s.mpn, ''-[0-9]+$'', ''''),
    p.brickeconomy_id
  INTO v_mpn, v_base_mpn, v_product_brickeconomy_id
  FROM public.sku s
  LEFT JOIN public.product p ON p.id = s.product_id
  WHERE s.id = p_sku_id;

  SELECT bec.retail_price, bec.currency
  INTO v_brickeconomy_rrp, v_brickeconomy_rrp_currency
  FROM public.brickeconomy_collection bec
  WHERE bec.retail_price IS NOT NULL
    AND bec.retail_price > 0
    AND bec.item_number IN (v_product_brickeconomy_id, v_mpn, v_base_mpn)
  ORDER BY
    CASE
      WHEN bec.item_number = v_product_brickeconomy_id THEN 0
      WHEN bec.item_number = v_mpn THEN 1
      WHEN bec.item_number = v_base_mpn THEN 2
      ELSE 3
    END,
    CASE WHEN bec.currency = ''GBP'' THEN 0 ELSE 1 END,
    bec.synced_at DESC
  LIMIT 1;

  SELECT
    COALESCE(cpc.market_undercut_min_pct, 0),
    COALESCE(cpc.market_undercut_min_amount, 0),
    cpc.market_undercut_max_pct,
    cpc.market_undercut_max_amount
  INTO v_min_undercut_pct, v_min_undercut_amount, v_max_undercut_pct, v_max_undercut_amount
  FROM public.channel_pricing_config cpc
  WHERE cpc.channel = v_channel
  LIMIT 1;

  v_min_undercut_pct := CASE WHEN COALESCE(v_min_undercut_pct, 0) > 1 THEN v_min_undercut_pct / 100 ELSE COALESCE(v_min_undercut_pct, 0) END;
  IF v_max_undercut_pct IS NOT NULL AND v_max_undercut_pct > 1 THEN
    v_max_undercut_pct := v_max_undercut_pct / 100;
  END IF;

  v_floor := GREATEST((v_cost_base + v_min_profit) * v_vat_multiplier, 0);

  FOR i IN 1..8 LOOP
    v_previous_floor := v_floor;
    v_floor_fees_gross := 0;

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
      END IF;

      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;

      v_floor_fees_gross := v_floor_fees_gross + v_fee_amount;
    END LOOP;

    v_floor_net_receipts := ROUND(v_floor / v_vat_multiplier, 2);
    v_floor_fees_net := ROUND(v_floor_fees_gross / v_vat_multiplier, 2);
    v_floor_risk_reserve := ROUND(v_floor_net_receipts * v_risk_rate, 2);
    v_floor := ROUND(
      GREATEST(
        (
          (v_cost_base + v_floor_fees_net + v_floor_risk_reserve + v_min_profit)
          / GREATEST(1 - GREATEST(v_min_margin, 0), 0.05)
        ) * v_vat_multiplier,
        0
      ),
      2
    );

    IF abs(v_floor - v_previous_floor) < 0.01 THEN
      EXIT;
    END IF;
  END LOOP;

  v_floor_fees_gross := ROUND(v_floor_fees_gross, 2);
  v_floor_fees_net := ROUND(v_floor_fees_gross / v_vat_multiplier, 2);
  v_floor_fee_input_vat := ROUND(v_floor_fees_gross - v_floor_fees_net, 2);
  v_floor_net_receipts := ROUND(v_floor / v_vat_multiplier, 2);
  v_floor_output_vat := ROUND(v_floor - v_floor_net_receipts, 2);
  v_floor_risk_reserve := ROUND(v_floor_net_receipts * v_risk_rate, 2);
  v_margin_uplift := ROUND(GREATEST(v_floor_net_receipts - v_cost_base - v_floor_fees_net - v_floor_risk_reserve - v_min_profit, 0), 2);

  IF v_brickeconomy_rrp IS NOT NULL AND v_brickeconomy_rrp > 0 THEN
    v_condition_adjusted_rrp := ROUND(GREATEST(v_brickeconomy_rrp * v_condition_multiplier, 0), 2);
    v_market_anchor := v_condition_adjusted_rrp;

    IF v_market_consensus IS NOT NULL AND v_market_consensus > 0 AND v_condition_adjusted_rrp > 0 THEN
      v_market_gap := ROUND(GREATEST(v_condition_adjusted_rrp - v_market_consensus, 0), 2);
      v_market_gap_ratio := LEAST(1, GREATEST(0, v_market_gap / v_condition_adjusted_rrp));
      v_market_weight := LEAST(1, GREATEST(0, v_market_confidence) * v_market_gap_ratio);
      v_market_weighted_undercut := ROUND(v_market_gap * v_market_weight, 2);
    ELSE
      v_warnings := COALESCE(v_warnings, ''[]''::jsonb) || jsonb_build_array(''missing_market_consensus'');
    END IF;

    v_minimum_undercut := ROUND(GREATEST(
      v_condition_adjusted_rrp * COALESCE(v_min_undercut_pct, 0),
      COALESCE(v_min_undercut_amount, 0)
    ), 2);

    IF v_max_undercut_pct IS NOT NULL OR v_max_undercut_amount IS NOT NULL THEN
      v_maximum_undercut := ROUND(GREATEST(
        COALESCE(v_condition_adjusted_rrp * v_max_undercut_pct, 0),
        COALESCE(v_max_undercut_amount, 0)
      ), 2);
      IF v_maximum_undercut <= 0 THEN
        v_maximum_undercut := NULL;
      END IF;
    END IF;

    v_applied_market_undercut := GREATEST(v_minimum_undercut, v_market_weighted_undercut);
    IF v_maximum_undercut IS NOT NULL THEN
      v_applied_market_undercut := LEAST(v_applied_market_undercut, v_maximum_undercut);
    END IF;

    v_market_target := GREATEST(v_condition_adjusted_rrp - v_applied_market_undercut, 0);
    v_target := floor(v_market_target) + 0.99;
    IF v_target > v_market_target THEN
      v_target := v_target - 1;
    END IF;
    v_target := ROUND(GREATEST(v_target, v_floor), 2);
    IF v_target = ROUND(v_floor, 2) AND v_market_target < v_floor THEN
      v_target_floor_clamped := true;
    END IF;
  ELSIF v_market_anchor IS NOT NULL AND v_market_anchor > 0 THEN
    v_warnings := COALESCE(v_warnings, ''[]''::jsonb) || jsonb_build_array(''missing_brickeconomy_rrp'');
    v_market_target := GREATEST(v_market_anchor - v_applied_market_undercut, 0);
    v_target := floor(v_market_target) + 0.99;
    IF v_target > v_market_target THEN
      v_target := v_target - 1;
    END IF;
    v_target := ROUND(GREATEST(v_target, v_floor), 2);
    IF v_target = ROUND(v_floor, 2) AND v_market_target < v_floor THEN
      v_target_floor_clamped := true;
    END IF;
  ELSE
    v_warnings := COALESCE(v_warnings, ''[]''::jsonb) || jsonb_build_array(''missing_brickeconomy_rrp'');
    v_target := ROUND(v_floor, 2);
  END IF;

  v_ceiling := floor(GREATEST(v_floor, COALESCE(v_condition_adjusted_rrp, v_market_anchor, v_floor))) + 0.99;
  IF v_ceiling < v_floor THEN
    v_ceiling := v_floor;
  END IF;

  IF v_target < v_floor THEN
    v_target := ROUND(v_floor, 2);
    v_target_floor_clamped := true;
  END IF;

  IF p_candidate_price IS NOT NULL AND p_candidate_price > 0 THEN
    v_gross_price := ROUND(p_candidate_price, 2);
  ELSE
    v_gross_price := ROUND(v_target, 2);
  END IF;

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
    END IF;

    v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
    IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
    IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;

    v_total_channel_fees_gross := v_total_channel_fees_gross + v_fee_amount;
  END LOOP;

  v_total_channel_fees_gross := ROUND(v_total_channel_fees_gross, 2);
  v_total_channel_fees_net := ROUND(v_total_channel_fees_gross / v_vat_multiplier, 2);
  v_channel_fee_input_vat := ROUND(v_total_channel_fees_gross - v_total_channel_fees_net, 2);
  v_net_sale_receipts := ROUND(v_gross_price / v_vat_multiplier, 2);
  v_output_vat := ROUND(v_gross_price - v_net_sale_receipts, 2);
  v_risk_reserve := ROUND(v_net_sale_receipts * v_risk_rate, 2);
  v_estimated_cash_after_fees := ROUND(v_gross_price - v_total_channel_fees_gross, 2);
  v_estimated_net_after_vat := ROUND(v_net_sale_receipts - v_total_channel_fees_net, 2);
  v_expected_margin := ROUND(v_estimated_net_after_vat - v_risk_reserve - v_program_commission - v_cost_base, 2);
  v_expected_margin_rate := CASE WHEN v_net_sale_receipts > 0 THEN ROUND(v_expected_margin / v_net_sale_receipts, 6) ELSE NULL END;

  v_target_net_receipts := ROUND(v_target / v_vat_multiplier, 2);
  v_target_output_vat := ROUND(v_target - v_target_net_receipts, 2);
  v_target_fees_gross := 0;
  FOR v_fee IN
    SELECT DISTINCT ON (lower(cfs.fee_name), cfs.applies_to)
      cfs.*
    FROM public.channel_fee_schedule cfs
    WHERE cfs.channel = v_channel
      AND cfs.active = true
    ORDER BY lower(cfs.fee_name), cfs.applies_to, cfs.updated_at DESC, cfs.created_at DESC
  LOOP
    v_fee_base := v_target;
    IF v_fee.applies_to = ''sale_plus_shipping'' THEN
      v_fee_base := v_target + v_delivery_cost;
    END IF;
    v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
    IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
    IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
    v_target_fees_gross := v_target_fees_gross + v_fee_amount;
  END LOOP;
  v_target_fees_gross := ROUND(v_target_fees_gross, 2);
  v_target_fees_net := ROUND(v_target_fees_gross / v_vat_multiplier, 2);
  v_target_net_position := ROUND(v_target_net_receipts - v_target_fees_net - (v_target_net_receipts * v_risk_rate) - v_program_commission - v_cost_base, 2);

  SELECT COALESCE(jsonb_agg(to_jsonb(value)), ''[]''::jsonb)
  INTO v_blocking
  FROM jsonb_array_elements_text(COALESCE(v_quote->''blocking_reasons'', ''[]''::jsonb)) AS value
  WHERE value <> ''below_channel_net_floor'';

  IF v_gross_price <= 0 THEN
    v_blocking := v_blocking || jsonb_build_array(''missing_price'');
    v_override_required := true;
  END IF;
  IF v_gross_price < v_floor THEN
    v_blocking := v_blocking || jsonb_build_array(''below_channel_net_floor'');
    v_override_required := true;
  END IF;

  v_floor_contributors := jsonb_build_array(
    jsonb_build_object(''key'', ''pooled_carrying_value'', ''label'', ''Pooled carrying value'', ''amount'', ROUND(v_pooled_carrying_value, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''packaging_cost'', ''label'', ''Packaging'', ''amount'', ROUND(v_packaging_cost, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''delivery_cost'', ''label'', ''Delivery'', ''amount'', ROUND(v_delivery_cost, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''estimated_channel_fees'', ''label'', ''Channel fees paid (gross)'', ''amount'', v_floor_fees_gross, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''channel_fee_input_vat_reclaim'', ''label'', ''Fee VAT reclaim'', ''amount'', v_floor_fee_input_vat * -1, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''risk_reserve'', ''label'', ''Risk reserve'', ''amount'', v_floor_risk_reserve, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''minimum_profit'', ''label'', ''Minimum profit'', ''amount'', ROUND(v_min_profit, 2), ''kind'', ''profit''),
    jsonb_build_object(''key'', ''margin_uplift'', ''label'', ''Margin uplift'', ''amount'', v_margin_uplift, ''kind'', ''margin''),
    jsonb_build_object(''key'', ''output_vat_payable'', ''label'', ''Output VAT payable'', ''amount'', v_floor_output_vat, ''kind'', ''vat'')
  );

  v_target_contributors := jsonb_build_array(
    jsonb_build_object(''key'', ''market_consensus'', ''label'', ''Market consensus (gross)'', ''amount'', COALESCE(ROUND(v_market_consensus, 2), 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''brickeconomy_rrp'', ''label'', ''BrickEconomy RRP'', ''amount'', COALESCE(ROUND(v_brickeconomy_rrp, 2), 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''condition_adjusted_rrp'', ''label'', ''Condition-adjusted RRP'', ''amount'', COALESCE(ROUND(v_condition_adjusted_rrp, 2), 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''market_weighted_rrp_undercut'', ''label'', ''Market-weighted RRP undercut'', ''amount'', ROUND(v_applied_market_undercut * -1, 2), ''kind'', ''rule''),
    jsonb_build_object(''key'', ''target_price'', ''label'', ''Target price (gross)'', ''amount'', ROUND(v_target, 2), ''kind'', ''result''),
    jsonb_build_object(''key'', ''target_output_vat'', ''label'', ''Target output VAT payable'', ''amount'', v_target_output_vat, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''target_net_receipts'', ''label'', ''Target receipts ex VAT'', ''amount'', v_target_net_receipts, ''kind'', ''result''),
    jsonb_build_object(''key'', ''target_net_position'', ''label'', ''Target net position'', ''amount'', v_target_net_position, ''kind'', ''margin''),
    jsonb_build_object(''key'', ''floor_gap'', ''label'', ''Floor comparison gap'', ''amount'', ROUND(v_target - v_floor, 2), ''kind'', ''comparison'')
  );

  RETURN v_quote
    || jsonb_build_object(
      ''gross_price'', v_gross_price,
      ''current_price'', v_gross_price,
      ''estimated_fees'', v_total_channel_fees_gross,
      ''estimated_fees_net'', v_total_channel_fees_net,
      ''estimated_fee_vat_reclaim'', v_channel_fee_input_vat,
      ''estimated_net'', v_estimated_cash_after_fees,
      ''estimated_net_after_vat'', v_estimated_net_after_vat,
      ''net_sale_receipts'', v_net_sale_receipts,
      ''output_vat'', v_output_vat,
      ''floor_price'', ROUND(v_floor, 2),
      ''target_price'', ROUND(v_target, 2),
      ''ceiling_price'', ROUND(GREATEST(v_ceiling, v_target, v_floor), 2),
      ''expected_gross_margin'', ROUND(v_gross_price - v_pooled_carrying_value, 2),
      ''expected_net_margin'', v_expected_margin,
      ''expected_net_margin_rate'', v_expected_margin_rate,
      ''blocking_reasons'', v_blocking,
      ''warning_reasons'', v_warnings,
      ''override_required'', v_override_required,
      ''floor_contributors'', v_floor_contributors,
      ''target_contributors'', v_target_contributors,
      ''brickeconomy_rrp'', v_brickeconomy_rrp,
      ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
      ''target_floor_clamped'', v_target_floor_clamped,
      ''vat_position'', jsonb_build_object(
        ''vat_rate_percent'', v_vat_rate_percent,
        ''vat_multiplier'', v_vat_multiplier,
        ''brickeconomy_rrp'', v_brickeconomy_rrp,
        ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
        ''market_weighted_rrp_undercut'', v_applied_market_undercut,
        ''sale_price_gross'', v_gross_price,
        ''sale_output_vat'', v_output_vat,
        ''sale_receipts_net_of_vat'', v_net_sale_receipts,
        ''channel_fees_gross_paid'', v_total_channel_fees_gross,
        ''channel_fee_input_vat_reclaim'', v_channel_fee_input_vat,
        ''channel_fees_net_cost'', v_total_channel_fees_net,
        ''cost_basis_net_paid'', v_cost_base,
        ''estimated_cash_after_fees'', v_estimated_cash_after_fees,
        ''estimated_net_after_vat_and_fees'', v_estimated_net_after_vat,
        ''risk_reserve_net'', v_risk_reserve,
        ''program_commission'', v_program_commission,
        ''net_position_after_vat'', v_expected_margin,
        ''floor'', jsonb_build_object(
          ''gross_price'', ROUND(v_floor, 2),
          ''output_vat'', v_floor_output_vat,
          ''receipts_net_of_vat'', v_floor_net_receipts,
          ''channel_fees_gross'', v_floor_fees_gross,
          ''channel_fee_input_vat_reclaim'', v_floor_fee_input_vat,
          ''channel_fees_net'', v_floor_fees_net,
          ''net_position'', ROUND(v_floor_net_receipts - v_floor_fees_net - v_floor_risk_reserve - v_program_commission - v_cost_base, 2)
        ),
        ''target'', jsonb_build_object(
          ''gross_price'', ROUND(v_target, 2),
          ''output_vat'', v_target_output_vat,
          ''receipts_net_of_vat'', v_target_net_receipts,
          ''channel_fees_gross'', v_target_fees_gross,
          ''channel_fees_net'', v_target_fees_net,
          ''net_position'', v_target_net_position
        )
      ),
      ''calculation_basis'', ''pool_wac_vat_risk_percent_fix_v1'',
      ''breakdown'', v_breakdown || jsonb_build_object(
        ''vat_rate_percent'', v_vat_rate_percent,
        ''vat_multiplier'', v_vat_multiplier,
        ''output_vat'', v_output_vat,
        ''net_sale_receipts'', v_net_sale_receipts,
        ''estimated_fees_gross'', v_total_channel_fees_gross,
        ''estimated_fees_net'', v_total_channel_fees_net,
        ''estimated_fee_vat_reclaim'', v_channel_fee_input_vat,
        ''estimated_net_after_vat'', v_estimated_net_after_vat,
        ''floor_output_vat'', v_floor_output_vat,
        ''floor_net_receipts'', v_floor_net_receipts,
        ''floor_fees_gross'', v_floor_fees_gross,
        ''floor_fees_net'', v_floor_fees_net,
        ''target_output_vat'', v_target_output_vat,
        ''target_net_receipts'', v_target_net_receipts,
        ''brickeconomy_rrp'', v_brickeconomy_rrp,
        ''brickeconomy_rrp_currency'', v_brickeconomy_rrp_currency,
        ''condition_multiplier'', v_condition_multiplier,
        ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
        ''market_gap_to_rrp'', v_market_gap,
        ''market_gap_ratio'', ROUND(v_market_gap_ratio, 6),
        ''market_confidence'', ROUND(v_market_confidence, 6),
        ''market_undercut_weight'', ROUND(v_market_weight, 6),
        ''market_weighted_rrp_undercut'', v_market_weighted_undercut,
        ''minimum_channel_undercut'', v_minimum_undercut,
        ''maximum_channel_undercut'', v_maximum_undercut,
        ''applied_market_undercut'', v_applied_market_undercut,
        ''target_floor_clamped'', CASE WHEN v_target_floor_clamped THEN 1 ELSE 0 END,
        ''market_target_below_floor'', 0
      )
    );
END;
';

GRANT EXECUTE ON FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
  TO authenticated, service_role;

DO '
BEGIN
  IF to_regprocedure(''public.create_price_decision_snapshot_pool_wac_no_vat(uuid,text,uuid,numeric,text,uuid)'') IS NULL THEN
    ALTER FUNCTION public.create_price_decision_snapshot(UUID, TEXT, UUID, NUMERIC, TEXT, UUID)
      RENAME TO create_price_decision_snapshot_pool_wac_no_vat;
  END IF;
END;
';

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
  v_snapshot_id UUID;
  v_quote JSONB;
BEGIN
  v_snapshot_id := public.create_price_decision_snapshot_pool_wac_no_vat(
    p_sku_id,
    p_channel,
    p_channel_listing_id,
    p_candidate_price,
    p_sales_program_code,
    p_actor_id
  );

  SELECT inputs INTO v_quote
  FROM public.price_decision_snapshot
  WHERE id = v_snapshot_id;

  UPDATE public.price_decision_snapshot
  SET
    expected_net_before_cogs = COALESCE(NULLIF(v_quote->>''estimated_net_after_vat'', '''')::numeric, expected_net_before_cogs),
    expected_margin_amount = COALESCE(NULLIF(v_quote->>''expected_net_margin'', '''')::numeric, expected_margin_amount),
    expected_margin_rate = COALESCE(NULLIF(v_quote->>''expected_net_margin_rate'', '''')::numeric, expected_margin_rate),
    calculation_version = ''pool_wac_vat_risk_percent_fix_v1''
  WHERE id = v_snapshot_id;

  IF p_channel_listing_id IS NOT NULL THEN
    UPDATE public.channel_listing
    SET estimated_net = COALESCE(NULLIF(v_quote->>''estimated_net_after_vat'', '''')::numeric, estimated_net)
    WHERE id = p_channel_listing_id;
  END IF;

  RETURN v_snapshot_id;
END;
';

GRANT EXECUTE ON FUNCTION public.create_price_decision_snapshot(UUID, TEXT, UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;