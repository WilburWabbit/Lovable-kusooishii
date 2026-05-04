DROP VIEW IF EXISTS public.v_current_sku_pricing;

CREATE OR REPLACE VIEW public.v_current_sku_pricing AS
WITH latest_listing_snapshot AS (
  SELECT DISTINCT ON (pds.sku_id, pds.channel)
    pds.*
  FROM public.price_decision_snapshot pds
  ORDER BY pds.sku_id, pds.channel, pds.created_at DESC
)
SELECT
  sk.id AS sku_id,
  sk.sku_code,
  sk.mpn,
  sk.condition_grade,
  lls.channel,
  COALESCE(lls.current_price, lls.target_price) AS current_price,
  lls.floor_price,
  lls.target_price,
  lls.ceiling_price,
  sk.avg_cost,
  sk.cost_range,
  COALESCE(lls.market_consensus_price, sk.market_price) AS market_price,
  lls.expected_margin_amount,
  lls.expected_margin_rate,
  lls.confidence_score,
  lls.recommendation,
  lls.blocking_reasons,
  lls.override_required,
  lls.created_at AS priced_at
FROM public.sku sk
LEFT JOIN latest_listing_snapshot lls ON lls.sku_id = sk.id;

GRANT SELECT ON public.v_current_sku_pricing TO authenticated;