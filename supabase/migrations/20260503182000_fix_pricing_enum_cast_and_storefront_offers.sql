-- Repair canonical price quotes and storefront offer pricing.
-- Lovable-safe: PL/pgSQL bodies use single-quoted strings, not dollar quotes.

DO '
DECLARE
  v_original TEXT;
  v_sql TEXT;
  v_replacement TEXT;
BEGIN
  SELECT pg_get_functiondef(''public.commerce_quote_price(uuid,text,numeric,text)''::regprocedure)
  INTO v_original;

  v_replacement := format(
    ''NULLIF(regexp_replace(sk.condition_grade::text, %L, %L, %L), %L)::integer'',
    ''[^0-9]'',
    '''',
    ''g'',
    ''''
  );

  v_sql := replace(v_original, ''sk.condition_grade::integer'', v_replacement);
  v_sql := replace(v_sql, ''sk.condition_grade::int'', v_replacement);

  IF v_sql = v_original THEN
    RAISE EXCEPTION ''commerce_quote_price did not contain the expected condition_grade cast'';
  END IF;

  EXECUTE v_sql;
END;
';

CREATE OR REPLACE FUNCTION public.product_detail_offers(p_mpn text)
RETURNS TABLE(sku_id uuid, sku_code text, condition_grade text, price numeric, stock_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS '
  WITH live_web_listing AS (
    SELECT DISTINCT ON (cl.sku_id)
      cl.sku_id,
      cl.listed_price,
      linked.current_price AS linked_current_price,
      linked.target_price AS linked_target_price
    FROM public.channel_listing cl
    LEFT JOIN public.price_decision_snapshot linked
      ON linked.id = cl.current_price_decision_snapshot_id
    WHERE cl.sku_id IS NOT NULL
      AND (
        cl.channel = ''web''
        OR cl.v2_channel::text = ''website''
      )
      AND (
        upper(COALESCE(cl.offer_status, '''')) = ''PUBLISHED''
        OR cl.v2_status::text = ''live''
      )
    ORDER BY
      cl.sku_id,
      CASE WHEN cl.v2_status::text = ''live'' THEN 0 ELSE 1 END,
      COALESCE(cl.listed_at, cl.updated_at, cl.created_at) DESC
  ),
  latest_web_snapshot AS (
    SELECT DISTINCT ON (pds.sku_id)
      pds.sku_id,
      pds.current_price AS snapshot_current_price,
      pds.target_price AS snapshot_target_price
    FROM public.price_decision_snapshot pds
    WHERE pds.channel IN (''web'', ''website'')
    ORDER BY pds.sku_id, pds.created_at DESC
  ),
  priced_offer AS (
    SELECT
      s.id AS sku_id,
      s.sku_code,
      s.condition_grade::text AS condition_grade,
      COALESCE(
        lwl.linked_target_price,
        lwl.linked_current_price,
        lws.snapshot_target_price,
        lws.snapshot_current_price,
        lwl.listed_price,
        s.price
      ) AS price,
      COUNT(su.id) AS stock_count
    FROM public.product p
    JOIN public.sku s
      ON s.product_id = p.id
     AND s.active_flag = true
     AND s.saleable_flag = true
    JOIN live_web_listing lwl
      ON lwl.sku_id = s.id
    LEFT JOIN latest_web_snapshot lws
      ON lws.sku_id = s.id
    JOIN public.stock_unit su
      ON su.sku_id = s.id
     AND COALESCE(su.v2_status::text, su.status::text) IN (''listed'', ''graded'', ''available'', ''restocked'')
    WHERE p.mpn = p_mpn
      AND p.status = ''active''
    GROUP BY
      s.id,
      s.sku_code,
      s.condition_grade,
      lwl.linked_target_price,
      lwl.linked_current_price,
      lws.snapshot_target_price,
      lws.snapshot_current_price,
      lwl.listed_price,
      s.price
  )
  SELECT
    priced_offer.sku_id,
    priced_offer.sku_code,
    priced_offer.condition_grade,
    priced_offer.price,
    priced_offer.stock_count
  FROM priced_offer
  WHERE priced_offer.price IS NOT NULL
    AND priced_offer.price > 0
  ORDER BY priced_offer.condition_grade;
';

DO '
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (cl.sku_id, normalized.channel)
      cl.sku_id,
      cl.id AS channel_listing_id,
      normalized.channel
    FROM public.channel_listing cl
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(NULLIF(cl.channel, ''''), cl.v2_channel::text, ''web'') = ''website'' THEN ''web''
        ELSE COALESCE(NULLIF(cl.channel, ''''), cl.v2_channel::text, ''web'')
      END AS channel
    ) normalized
    WHERE cl.sku_id IS NOT NULL
      AND normalized.channel IN (''web'', ''ebay'')
    ORDER BY
      cl.sku_id,
      normalized.channel,
      CASE
        WHEN cl.v2_status::text = ''live'' OR upper(COALESCE(cl.offer_status, '''')) = ''PUBLISHED'' THEN 0
        ELSE 1
      END,
      COALESCE(cl.listed_at, cl.updated_at, cl.created_at) DESC
  LOOP
    BEGIN
      PERFORM public.create_price_decision_snapshot(
        v_row.sku_id,
        v_row.channel,
        v_row.channel_listing_id,
        NULL,
        NULL,
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE ''Skipping price snapshot refresh for SKU % channel %: %'',
        v_row.sku_id,
        v_row.channel,
        SQLERRM;
    END;
  END LOOP;
END;
';
