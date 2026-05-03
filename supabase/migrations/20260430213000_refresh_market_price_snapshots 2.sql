-- Build current market consensus snapshots from normalized market signals.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies only.

INSERT INTO public.market_signal_source (source_code, name, source_type, rate_limit_per_day, metadata)
VALUES (
  'market_consensus',
  'Weighted Market Consensus',
  'market_data',
  NULL,
  jsonb_build_object('generated_by', 'refresh_market_price_snapshots')
)
ON CONFLICT (source_code) DO UPDATE
SET name = EXCLUDED.name,
    source_type = EXCLUDED.source_type,
    metadata = public.market_signal_source.metadata || EXCLUDED.metadata,
    updated_at = now();

CREATE INDEX IF NOT EXISTS idx_market_signal_recent_price
  ON public.market_signal(sku_id, channel, observed_at DESC)
  WHERE sku_id IS NOT NULL AND observed_price IS NOT NULL AND observed_price > 0;

CREATE INDEX IF NOT EXISTS idx_market_price_snapshot_source_sku_channel
  ON public.market_price_snapshot(source_id, sku_id, channel, captured_at DESC)
  WHERE sku_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_market_price_snapshots(p_sku_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_consensus_source_id UUID;
  v_internal_source_id UUID;
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  SELECT id INTO v_consensus_source_id
  FROM public.market_signal_source
  WHERE source_code = ''market_consensus'';

  SELECT id INTO v_internal_source_id
  FROM public.market_signal_source
  WHERE source_code = ''internal_realized_sale'';

  IF v_consensus_source_id IS NULL THEN
    RAISE EXCEPTION ''market_consensus source is missing'';
  END IF;

  IF v_internal_source_id IS NULL THEN
    RAISE EXCEPTION ''internal_realized_sale source is missing'';
  END IF;

  INSERT INTO public.market_signal (
    source_id,
    sku_id,
    mpn,
    condition_grade,
    channel,
    signal_type,
    observed_price,
    observed_price_min,
    observed_price_max,
    sample_size,
    vat_treatment,
    source_confidence,
    freshness_score,
    observed_at,
    metadata
  )
  SELECT
    v_internal_source_id,
    sol.sku_id,
    COALESCE(sk.mpn, p.mpn),
    sk.condition_grade,
    so.origin_channel,
    ''realized_margin'',
    ROUND((sol.line_total / NULLIF(sol.quantity, 0))::numeric, 2),
    ROUND((sol.line_total / NULLIF(sol.quantity, 0))::numeric, 2),
    ROUND((sol.line_total / NULLIF(sol.quantity, 0))::numeric, 2),
    GREATEST(sol.quantity, 1),
    ''inclusive'',
    0.85,
    GREATEST(0.10, LEAST(1.00, 1.00 - (EXTRACT(EPOCH FROM (now() - COALESCE(so.created_at, sol.created_at))) / 31536000.0)))::numeric,
    COALESCE(so.created_at, sol.created_at, now()),
    jsonb_build_object(
      ''sales_order_id'', sol.sales_order_id,
      ''sales_order_line_id'', sol.id,
      ''order_number'', so.order_number,
      ''origin_channel'', so.origin_channel
    )
  FROM public.sales_order_line sol
  JOIN public.sales_order so ON so.id = sol.sales_order_id
  JOIN public.sku sk ON sk.id = sol.sku_id
  LEFT JOIN public.product p ON p.id = sk.product_id
  WHERE (p_sku_id IS NULL OR sol.sku_id = p_sku_id)
    AND sol.quantity > 0
    AND sol.line_total > 0
    AND COALESCE(so.status::text, '''') NOT IN (''cancelled'', ''refunded'')
    AND NOT EXISTS (
      SELECT 1
      FROM public.market_signal ms
      WHERE ms.source_id = v_internal_source_id
        AND ms.metadata->>''sales_order_line_id'' = sol.id::text
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.market_price_snapshot (
    source_id,
    sku_id,
    mpn,
    condition_grade,
    channel,
    price,
    price_low,
    price_high,
    currency,
    vat_treatment,
    sample_size,
    confidence_score,
    freshness_score,
    captured_at,
    metadata
  )
  WITH weighted_signals AS (
    SELECT
      ms.sku_id,
      COALESCE(ms.mpn, sk.mpn, p.mpn) AS mpn,
      COALESCE(ms.condition_grade, sk.condition_grade) AS condition_grade,
      COALESCE(NULLIF(ms.channel, ''''), ''all'') AS channel,
      ms.observed_price,
      COALESCE(ms.observed_price_min, ms.observed_price) AS observed_price_min,
      COALESCE(ms.observed_price_max, ms.observed_price) AS observed_price_max,
      COALESCE(ms.sample_size, 1) AS sample_size,
      ms.vat_treatment,
      GREATEST(0.05, LEAST(1.00, COALESCE(ms.source_confidence, 0.50))) AS confidence_part,
      GREATEST(
        0.05,
        LEAST(
          1.00,
          COALESCE(
            ms.freshness_score,
            1.00 - (EXTRACT(EPOCH FROM (now() - ms.observed_at)) / 31536000.0)
          )
        )
      ) AS freshness_part
    FROM public.market_signal ms
    LEFT JOIN public.sku sk ON sk.id = ms.sku_id
    LEFT JOIN public.product p ON p.id = sk.product_id
    JOIN public.market_signal_source mss ON mss.id = ms.source_id
    WHERE (p_sku_id IS NULL OR ms.sku_id = p_sku_id)
      AND ms.sku_id IS NOT NULL
      AND ms.observed_price IS NOT NULL
      AND ms.observed_price > 0
      AND ms.observed_at >= now() - interval ''365 days''
      AND mss.active = true
      AND mss.source_code <> ''market_consensus''
  ),
  scored AS (
    SELECT
      ws.*,
      (ws.confidence_part * ws.freshness_part * LEAST(5.00, SQRT(GREATEST(ws.sample_size, 1)))) AS signal_weight
    FROM weighted_signals ws
  ),
  grouped AS (
    SELECT
      sku_id,
      mpn,
      condition_grade,
      channel,
      ROUND((SUM(observed_price * signal_weight) / NULLIF(SUM(signal_weight), 0))::numeric, 2) AS price,
      ROUND(MIN(observed_price_min)::numeric, 2) AS price_low,
      ROUND(MAX(observed_price_max)::numeric, 2) AS price_high,
      SUM(sample_size)::integer AS sample_size,
      ROUND(AVG(confidence_part)::numeric, 6) AS confidence_score,
      ROUND(AVG(freshness_part)::numeric, 6) AS freshness_score,
      COUNT(*) AS signal_count,
      jsonb_agg(DISTINCT vat_treatment) AS vat_treatments
    FROM scored
    GROUP BY sku_id, mpn, condition_grade, channel
  ),
  all_channel AS (
    SELECT
      sku_id,
      mpn,
      condition_grade,
      ''all'' AS channel,
      ROUND((SUM(observed_price * signal_weight) / NULLIF(SUM(signal_weight), 0))::numeric, 2) AS price,
      ROUND(MIN(observed_price_min)::numeric, 2) AS price_low,
      ROUND(MAX(observed_price_max)::numeric, 2) AS price_high,
      SUM(sample_size)::integer AS sample_size,
      ROUND(AVG(confidence_part)::numeric, 6) AS confidence_score,
      ROUND(AVG(freshness_part)::numeric, 6) AS freshness_score,
      COUNT(*) AS signal_count,
      jsonb_agg(DISTINCT vat_treatment) AS vat_treatments
    FROM scored
    GROUP BY sku_id, mpn, condition_grade
  ),
  combined AS (
    SELECT * FROM grouped WHERE channel <> ''all''
    UNION ALL
    SELECT * FROM all_channel
  )
  SELECT
    v_consensus_source_id,
    c.sku_id,
    c.mpn,
    c.condition_grade,
    c.channel,
    c.price,
    c.price_low,
    c.price_high,
    ''GBP'',
    CASE
      WHEN c.vat_treatments ? ''inclusive'' THEN ''inclusive''
      WHEN c.vat_treatments ? ''exclusive'' THEN ''exclusive''
      ELSE ''unknown''
    END,
    c.sample_size,
    c.confidence_score,
    c.freshness_score,
    now(),
    jsonb_build_object(
      ''generated_by'', ''refresh_market_price_snapshots'',
      ''signal_count'', c.signal_count,
      ''source_window_days'', 365
    )
  FROM combined c
  WHERE c.price IS NOT NULL
    AND c.price > 0;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.refresh_market_price_snapshots(UUID)
TO authenticated, service_role;
