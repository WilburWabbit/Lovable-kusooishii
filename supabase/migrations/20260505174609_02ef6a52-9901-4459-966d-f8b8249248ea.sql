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

  v_stock_cost_gross NUMERIC := 0;
  v_stock_input_vat NUMERIC := 0;
  v_stock_cost_net NUMERIC := 0;
  v_packaging_gross NUMERIC := 0;
  v_packaging_input_vat NUMERIC := 0;
  v_packaging_net NUMERIC := 0;
  v_delivery_gross NUMERIC := 0;
  v_delivery_input_vat NUMERIC := 0;
  v_delivery_net NUMERIC := 0;
  v_break_even_base_net NUMERIC := 0;

  v_min_profit NUMERIC := 1;
  v_min_margin NUMERIC := 0.05;
  v_risk_rate NUMERIC := 0;
  v_program_commission NUMERIC := 0;
  v_raw_min_margin NUMERIC := NULL;
  v_raw_risk_rate NUMERIC := NULL;

  v_mpn TEXT := NULL;
  v_base_mpn TEXT := NULL;
  v_product_brickeconomy_id TEXT := NULL;
  v_brickeconomy_rrp NUMERIC := NULL;
  v_brickeconomy_rrp_currency TEXT := NULL;
  v_rrp_vat_treatment TEXT := ''inclusive'';
  v_market_vat_treatment TEXT := ''inclusive'';
  v_raw_rrp_gross NUMERIC := NULL;
  v_raw_market_consensus_gross NUMERIC := NULL;
  v_target_anchor_gross NUMERIC := NULL;
  v_condition_multiplier NUMERIC := 1;
  v_condition_adjusted_anchor NUMERIC := NULL;
  v_condition_adjusted_rrp NUMERIC := NULL;
  v_market_consensus NUMERIC := NULL;
  v_market_confidence NUMERIC := 0.5;
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
  v_previous_price NUMERIC := 0;
  v_floor_fees_gross NUMERIC := 0;
  v_floor_fees_net NUMERIC := 0;
  v_floor_fee_input_vat NUMERIC := 0;
  v_floor_net_receipts NUMERIC := 0;
  v_floor_output_vat NUMERIC := 0;
  v_floor_price_before_target_vat NUMERIC := 0;
  v_floor_break_even_net_position NUMERIC := 0;

  v_target_profit_safeguard_price NUMERIC := 0;
  v_target_profit_safeguard_fees_gross NUMERIC := 0;
  v_target_profit_safeguard_fees_net NUMERIC := 0;
  v_target_margin_safeguard_price NUMERIC := 0;
  v_target_margin_safeguard_fees_gross NUMERIC := 0;
  v_target_margin_safeguard_fees_net NUMERIC := 0;
  v_target NUMERIC := 0;
  v_target_net_receipts NUMERIC := 0;
  v_target_output_vat NUMERIC := 0;
  v_target_fees_gross NUMERIC := 0;
  v_target_fees_net NUMERIC := 0;
  v_target_fee_input_vat NUMERIC := 0;
  v_target_risk_reserve NUMERIC := 0;
  v_target_margin_uplift NUMERIC := 0;
  v_target_net_position NUMERIC := 0;
  v_target_floor_clamped BOOLEAN := false;
  v_target_safeguard_clamped BOOLEAN := false;

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

  v_stock_cost_gross := COALESCE(NULLIF(v_quote->>''carrying_value'', '''')::numeric, 0);
  v_stock_cost_net := ROUND(v_stock_cost_gross / v_vat_multiplier, 2);
  v_stock_input_vat := ROUND(v_stock_cost_gross - v_stock_cost_net, 2);

  v_packaging_gross := COALESCE(NULLIF(v_quote->>''packaging_cost'', '''')::numeric, 0);
  v_packaging_net := ROUND(v_packaging_gross / v_vat_multiplier, 2);
  v_packaging_input_vat := ROUND(v_packaging_gross - v_packaging_net, 2);

  v_delivery_gross := COALESCE(NULLIF(v_quote->>''delivery_cost'', '''')::numeric, 0);
  v_delivery_net := ROUND(v_delivery_gross / v_vat_multiplier, 2);
  v_delivery_input_vat := ROUND(v_delivery_gross - v_delivery_net, 2);

  v_break_even_base_net := ROUND(v_stock_cost_net + v_packaging_net + v_delivery_net, 2);
  v_program_commission := COALESCE(NULLIF(v_quote->>''program_commission'', '''')::numeric, 0);
  v_min_profit := COALESCE(NULLIF(v_breakdown->>''min_profit'', '''')::numeric, 1);
  v_raw_min_margin := NULLIF(v_breakdown->>''min_margin'', '''')::numeric;
  v_raw_risk_rate := NULLIF(v_breakdown->>''risk_reserve_rate'', '''')::numeric;
  v_min_margin := CASE
    WHEN v_raw_min_margin IS NULL THEN 0.05
    WHEN v_raw_min_margin > 1 THEN v_raw_min_margin / 100
    ELSE v_raw_min_margin
  END;
  v_min_margin := LEAST(0.95, GREATEST(0, COALESCE(v_min_margin, 0.05)));
  v_risk_rate := GREATEST(COALESCE(v_raw_risk_rate, 0), 0) / 100;

  v_condition_multiplier := COALESCE(NULLIF(v_quote->>''condition_multiplier'', '''')::numeric, NULLIF(v_breakdown->>''condition_multiplier'', '''')::numeric, 1);
  v_market_consensus := NULLIF(v_quote->>''market_consensus'', '''')::numeric;
  v_market_confidence := COALESCE(NULLIF(v_quote->>''confidence_score'', '''')::numeric, NULLIF(v_quote->>''confidence'', '''')::numeric, 0.5);
  v_market_confidence := CASE
    WHEN v_market_confidence > 1 THEN v_market_confidence / 100
    ELSE v_market_confidence
  END;
  v_market_confidence := LEAST(1, GREATEST(0, COALESCE(v_market_confidence, 0.5)));

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

  v_rrp_vat_treatment := lower(COALESCE(v_breakdown->>''brickeconomy_rrp_vat_treatment'', ''inclusive''));
  v_market_vat_treatment := lower(COALESCE(v_quote->>''market_vat_treatment'', v_breakdown->>''market_vat_treatment'', ''inclusive''));
  v_raw_rrp_gross := CASE
    WHEN v_brickeconomy_rrp IS NULL THEN NULL
    WHEN v_rrp_vat_treatment IN (''exclusive'', ''ex_vat'', ''ex-vat'', ''net'') THEN ROUND(v_brickeconomy_rrp * v_vat_multiplier, 2)
    ELSE ROUND(v_brickeconomy_rrp, 2)
  END;
  v_raw_market_consensus_gross := CASE
    WHEN v_market_consensus IS NULL THEN NULL
    WHEN v_market_vat_treatment IN (''exclusive'', ''ex_vat'', ''ex-vat'', ''net'') THEN ROUND(v_market_consensus * v_vat_multiplier, 2)
    ELSE ROUND(v_market_consensus, 2)
  END;

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

  v_floor := GREATEST((v_break_even_base_net + v_program_commission) * v_vat_multiplier, 0);
  FOR i IN 1..10 LOOP
    v_previous_price := v_floor;
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
        v_fee_base := v_floor + v_delivery_gross;
      END IF;

      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;

      v_floor_fees_gross := v_floor_fees_gross + v_fee_amount;
    END LOOP;

    v_floor_fees_net := ROUND(v_floor_fees_gross / v_vat_multiplier, 2);
    v_floor := ROUND(GREATEST((v_break_even_base_net + v_floor_fees_net + v_program_commission) * v_vat_multiplier, 0), 2);

    IF abs(v_floor - v_previous_price) < 0.01 THEN
      EXIT;
    END IF;
  END LOOP;

  v_floor_fees_gross := ROUND(v_floor_fees_gross, 2);
  v_floor_fees_net := ROUND(v_floor_fees_gross / v_vat_multiplier, 2);
  v_floor_fee_input_vat := ROUND(v_floor_fees_gross - v_floor_fees_net, 2);
  v_floor_net_receipts := ROUND(v_floor / v_vat_multiplier, 2);
  v_floor_output_vat := ROUND(v_floor - v_floor_net_receipts, 2);
  v_floor_break_even_net_position := ROUND(v_floor_net_receipts - v_floor_fees_net - v_program_commission - v_break_even_base_net, 2);

  v_target_profit_safeguard_price := GREATEST(v_floor, (v_break_even_base_net + v_program_commission + v_min_profit) * v_vat_multiplier);
  FOR i IN 1..10 LOOP
    v_previous_price := v_target_profit_safeguard_price;
    v_target_profit_safeguard_fees_gross := 0;
    FOR v_fee IN
      SELECT DISTINCT ON (lower(cfs.fee_name), cfs.applies_to)
        cfs.*
      FROM public.channel_fee_schedule cfs
      WHERE cfs.channel = v_channel
        AND cfs.active = true
      ORDER BY lower(cfs.fee_name), cfs.applies_to, cfs.updated_at DESC, cfs.created_at DESC
    LOOP
      v_fee_base := v_target_profit_safeguard_price;
      IF v_fee.applies_to = ''sale_plus_shipping'' THEN
        v_fee_base := v_target_profit_safeguard_price + v_delivery_gross;
      END IF;
      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
      v_target_profit_safeguard_fees_gross := v_target_profit_safeguard_fees_gross + v_fee_amount;
    END LOOP;
    v_target_profit_safeguard_fees_net := ROUND(v_target_profit_safeguard_fees_gross / v_vat_multiplier, 2);
    v_target_profit_safeguard_price := ROUND(GREATEST((v_break_even_base_net + v_target_profit_safeguard_fees_net + v_program_commission + v_min_profit) * v_vat_multiplier, v_floor), 2);
    IF abs(v_target_profit_safeguard_price - v_previous_price) < 0.01 THEN EXIT; END IF;
  END LOOP;

  v_target_margin_safeguard_price := GREATEST(v_floor, v_target_profit_safeguard_price);
  FOR i IN 1..10 LOOP
    v_previous_price := v_target_margin_safeguard_price;
    v_target_margin_safeguard_fees_gross := 0;
    FOR v_fee IN
      SELECT DISTINCT ON (lower(cfs.fee_name), cfs.applies_to)
        cfs.*
      FROM public.channel_fee_schedule cfs
      WHERE cfs.channel = v_channel
        AND cfs.active = true
      ORDER BY lower(cfs.fee_name), cfs.applies_to, cfs.updated_at DESC, cfs.created_at DESC
    LOOP
      v_fee_base := v_target_margin_safeguard_price;
      IF v_fee.applies_to = ''sale_plus_shipping'' THEN
        v_fee_base := v_target_margin_safeguard_price + v_delivery_gross;
      END IF;
      v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
      IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
      IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
      v_target_margin_safeguard_fees_gross := v_target_margin_safeguard_fees_gross + v_fee_amount;
    END LOOP;
    v_target_margin_safeguard_fees_net := ROUND(v_target_margin_safeguard_fees_gross / v_vat_multiplier, 2);
    v_target_margin_safeguard_price := ROUND(GREATEST(
      ((v_break_even_base_net + v_target_margin_safeguard_fees_net + v_program_commission) / GREATEST(1 - v_min_margin, 0.05)) * v_vat_multiplier,
      v_floor
    ), 2);
    IF abs(v_target_margin_safeguard_price - v_previous_price) < 0.01 THEN EXIT; END IF;
  END LOOP;

  IF v_raw_rrp_gross IS NOT NULL AND v_raw_market_consensus_gross IS NOT NULL THEN
    v_target_anchor_gross := GREATEST(v_raw_rrp_gross, v_raw_market_consensus_gross);
  ELSIF v_raw_rrp_gross IS NOT NULL THEN
    v_target_anchor_gross := v_raw_rrp_gross;
    v_warnings := v_warnings || jsonb_build_array(''missing_market_consensus'');
  ELSIF v_raw_market_consensus_gross IS NOT NULL THEN
    v_target_anchor_gross := v_raw_market_consensus_gross;
    v_warnings := v_warnings || jsonb_build_array(''missing_brickeconomy_rrp'');
  ELSE
    v_warnings := v_warnings || jsonb_build_array(''missing_brickeconomy_rrp'', ''missing_market_consensus'');
  END IF;

  IF v_raw_rrp_gross IS NOT NULL THEN
    v_condition_adjusted_rrp := ROUND(GREATEST(v_raw_rrp_gross * v_condition_multiplier, 0), 2);
  END IF;

  IF v_target_anchor_gross IS NOT NULL AND v_target_anchor_gross > 0 THEN
    v_condition_adjusted_anchor := ROUND(GREATEST(v_target_anchor_gross * v_condition_multiplier, 0), 2);
    IF v_raw_market_consensus_gross IS NOT NULL AND v_raw_market_consensus_gross > 0 AND v_condition_adjusted_anchor > 0 THEN
      v_market_gap := ROUND(GREATEST(v_condition_adjusted_anchor - v_raw_market_consensus_gross, 0), 2);
      v_market_gap_ratio := LEAST(1, GREATEST(0, v_market_gap / v_condition_adjusted_anchor));
      v_market_weight := LEAST(1, GREATEST(0, v_market_confidence) * v_market_gap_ratio);
      v_market_weighted_undercut := ROUND(v_market_gap * v_market_weight, 2);
    END IF;

    v_minimum_undercut := ROUND(GREATEST(
      v_condition_adjusted_anchor * COALESCE(v_min_undercut_pct, 0),
      COALESCE(v_min_undercut_amount, 0)
    ), 2);

    IF v_max_undercut_pct IS NOT NULL OR v_max_undercut_amount IS NOT NULL THEN
      v_maximum_undercut := ROUND(GREATEST(
        COALESCE(v_condition_adjusted_anchor * v_max_undercut_pct, 0),
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

    v_market_target := GREATEST(v_condition_adjusted_anchor - v_applied_market_undercut, 0);
    v_target := floor(v_market_target) + 0.99;
    IF v_target > v_market_target THEN
      v_target := v_target - 1;
    END IF;
  ELSE
    v_market_target := NULL;
    v_target := 0;
  END IF;

  v_target := ROUND(GREATEST(
    COALESCE(v_target, 0),
    v_floor,
    v_target_profit_safeguard_price,
    v_target_margin_safeguard_price
  ), 2);
  v_target_floor_clamped := COALESCE(v_market_target, 0) < v_floor;
  v_target_safeguard_clamped := COALESCE(v_market_target, 0) < GREATEST(v_target_profit_safeguard_price, v_target_margin_safeguard_price);

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
      v_fee_base := v_gross_price + v_delivery_gross;
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
  v_expected_margin := ROUND(v_estimated_net_after_vat - v_risk_reserve - v_program_commission - v_break_even_base_net, 2);
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
      v_fee_base := v_target + v_delivery_gross;
    END IF;
    v_fee_amount := (v_fee_base * (COALESCE(v_fee.rate_percent, 0) / 100)) + COALESCE(v_fee.fixed_amount, 0);
    IF v_fee.min_amount IS NOT NULL AND v_fee_amount < v_fee.min_amount THEN v_fee_amount := v_fee.min_amount; END IF;
    IF v_fee.max_amount IS NOT NULL AND v_fee_amount > v_fee.max_amount THEN v_fee_amount := v_fee.max_amount; END IF;
    v_target_fees_gross := v_target_fees_gross + v_fee_amount;
  END LOOP;
  v_target_fees_gross := ROUND(v_target_fees_gross, 2);
  v_target_fees_net := ROUND(v_target_fees_gross / v_vat_multiplier, 2);
  v_target_fee_input_vat := ROUND(v_target_fees_gross - v_target_fees_net, 2);
  v_target_risk_reserve := ROUND(v_target_net_receipts * v_risk_rate, 2);
  v_target_net_position := ROUND(v_target_net_receipts - v_target_fees_net - v_target_risk_reserve - v_program_commission - v_break_even_base_net, 2);
  v_target_margin_uplift := ROUND(GREATEST(v_target_net_position - v_min_profit, 0), 2);

  v_floor_price_before_target_vat := v_floor;
  v_floor := ROUND(v_floor_price_before_target_vat + v_target_output_vat, 2);
  v_floor_net_receipts := ROUND(v_floor / v_vat_multiplier, 2);
  v_floor_output_vat := ROUND(v_floor - v_floor_net_receipts, 2);
  v_floor_break_even_net_position := ROUND(v_floor_net_receipts - v_floor_fees_net - v_program_commission - v_break_even_base_net, 2);
  v_ceiling := ROUND(GREATEST(
    COALESCE(v_raw_rrp_gross, 0),
    COALESCE(v_raw_market_consensus_gross, 0),
    v_floor
  ), 2);

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
    jsonb_build_object(''key'', ''stock_cost_gross_paid'', ''label'', ''Stock cost paid (gross)'', ''amount'', ROUND(v_stock_cost_gross, 2), ''kind'', ''cost''),
    jsonb_build_object(''key'', ''stock_input_vat_reclaim'', ''label'', ''Stock VAT reclaim'', ''amount'', v_stock_input_vat * -1, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''packaging_gross_paid'', ''label'', ''Packaging paid (gross)'', ''amount'', v_packaging_gross, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''packaging_input_vat_reclaim'', ''label'', ''Packaging VAT reclaim'', ''amount'', v_packaging_input_vat * -1, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''delivery_gross_paid'', ''label'', ''Delivery paid (gross)'', ''amount'', v_delivery_gross, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''delivery_input_vat_reclaim'', ''label'', ''Delivery VAT reclaim'', ''amount'', v_delivery_input_vat * -1, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''estimated_channel_fees'', ''label'', ''Channel fees paid (gross)'', ''amount'', v_floor_fees_gross, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''channel_fee_input_vat_reclaim'', ''label'', ''Fee VAT reclaim'', ''amount'', v_floor_fee_input_vat * -1, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''program_commission'', ''label'', ''Program commission'', ''amount'', v_program_commission, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''target_output_vat'', ''label'', ''Target sale output VAT payable'', ''amount'', v_target_output_vat, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''floor_break_even_net_position'', ''label'', ''Break-even net position'', ''amount'', v_floor_break_even_net_position, ''kind'', ''result'')
  );

  v_target_contributors := jsonb_build_array(
    jsonb_build_object(''key'', ''raw_rrp_gross'', ''label'', ''BrickEconomy RRP (gross)'', ''amount'', COALESCE(v_raw_rrp_gross, 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''raw_market_consensus_gross'', ''label'', ''Market consensus (gross)'', ''amount'', COALESCE(v_raw_market_consensus_gross, 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''target_anchor_gross'', ''label'', ''Chosen anchor before condition'', ''amount'', COALESCE(v_target_anchor_gross, 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''condition_adjusted_anchor'', ''label'', ''Condition-adjusted anchor'', ''amount'', COALESCE(v_condition_adjusted_anchor, 0), ''kind'', ''market''),
    jsonb_build_object(''key'', ''market_weighted_rrp_undercut'', ''label'', ''Market-weighted undercut'', ''amount'', ROUND(v_applied_market_undercut * -1, 2), ''kind'', ''rule''),
    jsonb_build_object(''key'', ''risk_reserve'', ''label'', ''Risk reserve'', ''amount'', v_target_risk_reserve, ''kind'', ''cost''),
    jsonb_build_object(''key'', ''minimum_profit'', ''label'', ''Minimum profit'', ''amount'', ROUND(v_min_profit, 2), ''kind'', ''profit''),
    jsonb_build_object(''key'', ''margin_uplift'', ''label'', ''Margin uplift'', ''amount'', v_target_margin_uplift, ''kind'', ''margin''),
    jsonb_build_object(''key'', ''target_profit_safeguard_price'', ''label'', ''Minimum profit safeguard'', ''amount'', ROUND(v_target_profit_safeguard_price, 2), ''kind'', ''profit''),
    jsonb_build_object(''key'', ''target_margin_safeguard_price'', ''label'', ''Minimum margin safeguard'', ''amount'', ROUND(v_target_margin_safeguard_price, 2), ''kind'', ''margin''),
    jsonb_build_object(''key'', ''target_price'', ''label'', ''Target price (gross)'', ''amount'', ROUND(v_target, 2), ''kind'', ''result''),
    jsonb_build_object(''key'', ''target_output_vat'', ''label'', ''Target output VAT payable'', ''amount'', v_target_output_vat, ''kind'', ''vat''),
    jsonb_build_object(''key'', ''target_net_receipts'', ''label'', ''Target receipts ex VAT'', ''amount'', v_target_net_receipts, ''kind'', ''result''),
    jsonb_build_object(''key'', ''target_net_position'', ''label'', ''Target net position after risk'', ''amount'', v_target_net_position, ''kind'', ''margin''),
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
      ''ceiling_price'', ROUND(v_ceiling, 2),
      ''expected_gross_margin'', ROUND(v_gross_price - v_stock_cost_gross, 2),
      ''expected_net_margin'', v_expected_margin,
      ''expected_net_margin_rate'', v_expected_margin_rate,
      ''blocking_reasons'', v_blocking,
      ''warning_reasons'', v_warnings,
      ''override_required'', v_override_required,
      ''floor_contributors'', v_floor_contributors,
      ''target_contributors'', v_target_contributors,
      ''brickeconomy_rrp'', v_raw_rrp_gross,
      ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
      ''target_floor_clamped'', v_target_floor_clamped,
      ''vat_position'', jsonb_build_object(
        ''vat_rate_percent'', v_vat_rate_percent,
        ''vat_multiplier'', v_vat_multiplier,
        ''stock_cost_gross_paid'', v_stock_cost_gross,
        ''stock_input_vat_reclaim'', v_stock_input_vat,
        ''stock_cost_net_after_reclaim'', v_stock_cost_net,
        ''packaging_gross_paid'', v_packaging_gross,
        ''packaging_input_vat_reclaim'', v_packaging_input_vat,
        ''packaging_net_cost'', v_packaging_net,
        ''delivery_gross_paid'', v_delivery_gross,
        ''delivery_input_vat_reclaim'', v_delivery_input_vat,
        ''delivery_net_cost'', v_delivery_net,
        ''cost_basis_net_paid'', v_stock_cost_net,
        ''actual_costs_net_after_reclaim'', v_break_even_base_net,
        ''brickeconomy_rrp'', v_raw_rrp_gross,
        ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
        ''raw_rrp_gross'', v_raw_rrp_gross,
        ''raw_market_consensus_gross'', v_raw_market_consensus_gross,
        ''target_anchor_gross'', v_target_anchor_gross,
        ''condition_adjusted_anchor'', v_condition_adjusted_anchor,
        ''market_weighted_rrp_undercut'', v_applied_market_undercut,
        ''target_profit_safeguard_price'', v_target_profit_safeguard_price,
        ''target_margin_safeguard_price'', v_target_margin_safeguard_price,
        ''sale_price_gross'', v_gross_price,
        ''sale_output_vat'', v_output_vat,
        ''sale_receipts_net_of_vat'', v_net_sale_receipts,
        ''channel_fees_gross_paid'', v_total_channel_fees_gross,
        ''channel_fee_input_vat_reclaim'', v_channel_fee_input_vat,
        ''channel_fees_net_cost'', v_total_channel_fees_net,
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
          ''break_even_net_position'', v_floor_break_even_net_position
        ),
        ''target'', jsonb_build_object(
          ''gross_price'', ROUND(v_target, 2),
          ''output_vat'', v_target_output_vat,
          ''receipts_net_of_vat'', v_target_net_receipts,
          ''channel_fees_gross'', v_target_fees_gross,
          ''channel_fee_input_vat_reclaim'', v_target_fee_input_vat,
          ''channel_fees_net'', v_target_fees_net,
          ''risk_reserve_net'', v_target_risk_reserve,
          ''net_position'', v_target_net_position
        )
      ),
      ''calculation_basis'', ''pool_wac_vat_break_even_floor_v1'',
      ''breakdown'', v_breakdown || jsonb_build_object(
        ''vat_rate_percent'', v_vat_rate_percent,
        ''vat_multiplier'', v_vat_multiplier,
        ''output_vat'', v_output_vat,
        ''net_sale_receipts'', v_net_sale_receipts,
        ''estimated_fees_gross'', v_total_channel_fees_gross,
        ''estimated_fees_net'', v_total_channel_fees_net,
        ''estimated_fee_vat_reclaim'', v_channel_fee_input_vat,
        ''estimated_net_after_vat'', v_estimated_net_after_vat,
        ''stock_cost_gross_paid'', v_stock_cost_gross,
        ''stock_input_vat_reclaim'', v_stock_input_vat,
        ''stock_cost_net_after_reclaim'', v_stock_cost_net,
        ''packaging_gross_paid'', v_packaging_gross,
        ''packaging_input_vat_reclaim'', v_packaging_input_vat,
        ''packaging_net_cost'', v_packaging_net,
        ''delivery_gross_paid'', v_delivery_gross,
        ''delivery_input_vat_reclaim'', v_delivery_input_vat,
        ''delivery_net_cost'', v_delivery_net,
        ''floor_output_vat'', v_floor_output_vat,
        ''floor_price_before_target_vat'', v_floor_price_before_target_vat,
        ''floor_net_receipts'', v_floor_net_receipts,
        ''floor_fees_gross'', v_floor_fees_gross,
        ''floor_fees_net'', v_floor_fees_net,
        ''floor_break_even_net_position'', v_floor_break_even_net_position,
        ''target_output_vat'', v_target_output_vat,
        ''target_net_receipts'', v_target_net_receipts,
        ''target_risk_reserve'', v_target_risk_reserve,
        ''target_margin_uplift'', v_target_margin_uplift,
        ''target_profit_safeguard_price'', v_target_profit_safeguard_price,
        ''target_margin_safeguard_price'', v_target_margin_safeguard_price,
        ''raw_rrp_gross'', v_raw_rrp_gross,
        ''raw_market_consensus_gross'', v_raw_market_consensus_gross,
        ''target_anchor_gross'', v_target_anchor_gross,
        ''brickeconomy_rrp'', v_raw_rrp_gross,
        ''brickeconomy_rrp_currency'', v_brickeconomy_rrp_currency,
        ''condition_multiplier'', v_condition_multiplier,
        ''condition_adjusted_rrp'', v_condition_adjusted_rrp,
        ''condition_adjusted_anchor'', v_condition_adjusted_anchor,
        ''market_gap_to_anchor'', v_market_gap,
        ''market_gap_ratio'', ROUND(v_market_gap_ratio, 6),
        ''market_confidence'', ROUND(v_market_confidence, 6),
        ''market_undercut_weight'', ROUND(v_market_weight, 6),
        ''market_weighted_rrp_undercut'', v_market_weighted_undercut,
        ''minimum_channel_undercut'', v_minimum_undercut,
        ''maximum_channel_undercut'', v_maximum_undercut,
        ''applied_market_undercut'', v_applied_market_undercut,
        ''risk_reserve_rate'', ROUND(v_risk_rate * 100, 4),
        ''target_floor_clamped'', CASE WHEN v_target_floor_clamped THEN 1 ELSE 0 END,
        ''target_safeguard_clamped'', CASE WHEN v_target_safeguard_clamped THEN 1 ELSE 0 END,
        ''market_target_below_floor'', CASE WHEN v_target_floor_clamped THEN 1 ELSE 0 END
      )
    );
END;
';

GRANT EXECUTE ON FUNCTION public.commerce_quote_price(UUID, TEXT, NUMERIC, TEXT)
  TO authenticated, service_role;