-- Repair canonical price quotes and storefront offer pricing.
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
  SELECT sku_id, sku_code, condition_grade, price, stock_count
  FROM priced_offer
  WHERE stock_count > 0
';