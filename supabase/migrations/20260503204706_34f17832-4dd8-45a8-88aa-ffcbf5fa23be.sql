CREATE TABLE IF NOT EXISTS public.pricing_recalc_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_listing_id UUID NOT NULL REFERENCES public.channel_listing(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES public.sku(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  current_price NUMERIC(12,2) NOT NULL,
  proposed_price NUMERIC(12,2) NOT NULL,
  pct_change NUMERIC(8,6) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('increase','decrease')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_recalc_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing_recalc_review_queue_staff_all" ON public.pricing_recalc_review_queue;
CREATE POLICY "pricing_recalc_review_queue_staff_all" ON public.pricing_recalc_review_queue
FOR ALL TO authenticated
USING (public.subledger_staff_read_policy())
WITH CHECK (public.subledger_staff_read_policy());

CREATE INDEX IF NOT EXISTS idx_pricing_recalc_review_queue_listing
  ON public.pricing_recalc_review_queue(channel_listing_id, status, created_at DESC);

DROP TRIGGER IF EXISTS set_pricing_recalc_review_queue_updated_at
  ON public.pricing_recalc_review_queue;
CREATE TRIGGER set_pricing_recalc_review_queue_updated_at
  BEFORE UPDATE ON public.pricing_recalc_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
      AND (cl.channel = ''web'' OR cl.v2_channel::text = ''website'')
      AND (upper(COALESCE(cl.offer_status, '''')) = ''PUBLISHED'' OR cl.v2_status::text = ''live'')
    ORDER BY cl.sku_id,
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
    SELECT s.id AS sku_id, s.sku_code, s.condition_grade::text AS condition_grade,
      COALESCE(
        lwl.listed_price,
        lwl.linked_target_price,
        lwl.linked_current_price,
        lws.snapshot_target_price,
        lws.snapshot_current_price,
        s.price
      ) AS price,
      COUNT(su.id) AS stock_count
    FROM public.product p
    JOIN public.sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
    JOIN live_web_listing lwl ON lwl.sku_id = s.id
    LEFT JOIN latest_web_snapshot lws ON lws.sku_id = s.id
    JOIN public.stock_unit su ON su.sku_id = s.id
      AND COALESCE(su.v2_status::text, su.status::text) IN (''listed'', ''graded'', ''available'', ''restocked'')
    WHERE p.mpn = p_mpn AND p.status = ''active''
    GROUP BY s.id, s.sku_code, s.condition_grade,
      lwl.listed_price,
      lwl.linked_target_price, lwl.linked_current_price,
      lws.snapshot_target_price, lws.snapshot_current_price,
      s.price
  )
  SELECT priced_offer.sku_id, priced_offer.sku_code, priced_offer.condition_grade,
    priced_offer.price, priced_offer.stock_count
  FROM priced_offer
  WHERE priced_offer.price IS NOT NULL AND priced_offer.price > 0
  ORDER BY priced_offer.condition_grade;
';