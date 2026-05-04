-- Canonical pricing calculation for admin UI, snapshots, and publish checks.
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
  -- Body proxied from migration file via \i
  RAISE EXCEPTION ''placeholder'';
END;
';
