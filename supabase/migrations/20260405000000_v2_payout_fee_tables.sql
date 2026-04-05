-- ============================================================
-- Admin V2 — Migration: Per-Sale Fee Attribution (Phase 1)
--
-- Problem solved: payouts.fee_breakdown is a single aggregate
-- JSONB blob with no per-sale linkage, making accurate per-unit
-- profit calculation impossible. Fees are typically 17–25% of
-- revenue, so reported margins are materially overstated.
--
-- Solution: two new tables capture per-order fee granularity
-- that the eBay Finances API already provides at transaction
-- level. A view computes net profit per stock unit.
--
-- Tables: payout_fee, payout_fee_line
-- View:   unit_profit_view
-- ============================================================

-- ─── 1. payout_fee ────────────────────────────────────────────────────────────
-- One row per (payout, sales_order, fee_category).
-- sales_order_id is NULL for platform-level fees that cannot be
-- linked to a specific sale (e.g. monthly subscription).

CREATE TABLE IF NOT EXISTS public.payout_fee (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id         UUID          NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  sales_order_id    UUID          REFERENCES public.sales_order(id),
  external_order_id TEXT,         -- eBay orderId — preserved for traceability / late-matching
  fee_category      TEXT          NOT NULL CHECK (fee_category IN (
                                    'selling_fee',        -- FVF, fixed-per-order, international component
                                    'shipping_label',     -- eBay-purchased postage label
                                    'payment_processing', -- Stripe per-charge fee
                                    'advertising',        -- Promoted Listings (standard & advanced)
                                    'subscription',       -- Monthly platform fees
                                    'other'               -- Disputes, adjustments, uncategorised
                                  )),
  amount            NUMERIC(12,4) NOT NULL CHECK (amount >= 0),
  channel           TEXT          NOT NULL DEFAULT 'ebay',
  description       TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payout_fee IS
  'Per-sale fee attribution from channel payouts. '
  'One row per (payout, order, category). '
  'Replaces the aggregate fee_breakdown JSONB on the payouts table for analytical purposes.';

COMMENT ON COLUMN public.payout_fee.sales_order_id IS
  'NULL for platform-level fees (subscription, store fees) that cannot be linked to a specific sale.';

COMMENT ON COLUMN public.payout_fee.external_order_id IS
  'Raw eBay orderId preserved for traceability and late-matching when a local sales_order record '
  'did not exist at import time.';

-- ─── 2. payout_fee_line ──────────────────────────────────────────────────────
-- Raw itemised fee lines from eBay. Preserves the original granularity
-- (e.g. a single order may have both FINAL_VALUE_FEE and FINAL_VALUE_FEE_SHIPPING
-- which are both mapped to the 'selling_fee' category). Required for audit,
-- QBO reconciliation, and future re-categorisation.

CREATE TABLE IF NOT EXISTS public.payout_fee_line (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_fee_id         UUID          NOT NULL REFERENCES public.payout_fee(id) ON DELETE CASCADE,
  ebay_transaction_id   TEXT,         -- eBay transactionId for traceability
  fee_type              TEXT          NOT NULL, -- raw eBay feeType e.g. FINAL_VALUE_FEE
  fee_category          TEXT          NOT NULL, -- mapped category (denormalised for query convenience)
  amount                NUMERIC(12,4) NOT NULL CHECK (amount >= 0),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payout_fee_line IS
  'Raw eBay fee lines for audit and reconciliation. '
  'Each row is one fee entry from eBay orderLineItems[].fees[].';

-- ─── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payout_fee_payout_id
  ON public.payout_fee(payout_id);

CREATE INDEX IF NOT EXISTS idx_payout_fee_sales_order_id
  ON public.payout_fee(sales_order_id);

-- Supports late-matching: find unlinked fees by external_order_id after order import
CREATE INDEX IF NOT EXISTS idx_payout_fee_external_order_id
  ON public.payout_fee(external_order_id)
  WHERE sales_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_payout_fee_category
  ON public.payout_fee(fee_category);

CREATE INDEX IF NOT EXISTS idx_payout_fee_line_payout_fee_id
  ON public.payout_fee_line(payout_fee_id);

-- ─── 4. updated_at trigger ───────────────────────────────────────────────────

CREATE TRIGGER update_payout_fee_updated_at
  BEFORE UPDATE ON public.payout_fee
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 5. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.payout_fee      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_fee_line ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions): full access
CREATE POLICY "service_role_all_payout_fee"
  ON public.payout_fee FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_payout_fee_line"
  ON public.payout_fee_line FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Authenticated users (admin UI): read-only
CREATE POLICY "auth_select_payout_fee"
  ON public.payout_fee FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "auth_select_payout_fee_line"
  ON public.payout_fee_line FOR SELECT
  TO authenticated USING (true);

-- ─── 6. unit_profit_view ──────────────────────────────────────────────────────
-- Net profit per stock unit, computed as:
--   gross_revenue (unit_price from sales_order_line)
--   - landed_cost (from stock_unit)
--   - fees per unit (order-level fees ÷ unit count for that order)
--
-- Fees are at order level, units at line level, so we equallyapportion
-- by dividing each fee category by the number of sold units in the order.
-- This is the correct approach when eBay charges one shipping label per
-- order regardless of how many units it contains.
--
-- Only includes units that have been linked to a sales order.

CREATE OR REPLACE VIEW public.unit_profit_view AS

WITH order_unit_counts AS (
  -- How many stock units shipped per order (for fee apportionment)
  SELECT
    sol.sales_order_id,
    COUNT(sol.stock_unit_id) AS unit_count
  FROM public.sales_order_line sol
  WHERE sol.stock_unit_id IS NOT NULL
  GROUP BY sol.sales_order_id
),

order_fee_totals AS (
  -- Aggregate payout_fee by order and category
  SELECT
    pf.sales_order_id,
    SUM(pf.amount) FILTER (WHERE pf.fee_category = 'selling_fee')         AS selling_fee,
    SUM(pf.amount) FILTER (WHERE pf.fee_category = 'shipping_label')      AS shipping_fee,
    SUM(pf.amount) FILTER (WHERE pf.fee_category = 'payment_processing')  AS processing_fee,
    SUM(pf.amount) FILTER (WHERE pf.fee_category = 'advertising')         AS advertising_fee,
    SUM(pf.amount)                                                          AS total_fees
  FROM public.payout_fee pf
  WHERE pf.sales_order_id IS NOT NULL
  GROUP BY pf.sales_order_id
)

SELECT
  su.id                                                               AS stock_unit_id,
  su.uid,
  su.sku,
  su.v2_status,
  su.batch_id,
  su.payout_id,

  -- Revenue: exact unit price from the order line (not averaged)
  sol.sales_order_id,
  sol.unit_price                                                      AS gross_revenue,

  -- Cost
  COALESCE(su.landed_cost, 0)                                        AS landed_cost,

  -- Fees apportioned equally across all units in the order
  ROUND(COALESCE(oft.selling_fee    / NULLIF(ouc.unit_count, 0), 0), 4) AS selling_fee,
  ROUND(COALESCE(oft.shipping_fee   / NULLIF(ouc.unit_count, 0), 0), 4) AS shipping_fee,
  ROUND(COALESCE(oft.processing_fee / NULLIF(ouc.unit_count, 0), 0), 4) AS processing_fee,
  ROUND(COALESCE(oft.advertising_fee/ NULLIF(ouc.unit_count, 0), 0), 4) AS advertising_fee,
  ROUND(COALESCE(oft.total_fees     / NULLIF(ouc.unit_count, 0), 0), 4) AS total_fees_per_unit,

  -- Net profit = revenue - cost - fees
  ROUND(
    sol.unit_price
    - COALESCE(su.landed_cost, 0)
    - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0), 0),
    4
  )                                                                   AS net_profit,

  -- Net margin %
  CASE
    WHEN sol.unit_price > 0 THEN
      ROUND(
        (
          sol.unit_price
          - COALESCE(su.landed_cost, 0)
          - COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0), 0)
        ) / sol.unit_price * 100,
        2
      )
    ELSE NULL
  END                                                                 AS net_margin_pct,

  -- Gross margin % (before fees — useful for spotting pricing issues)
  CASE
    WHEN sol.unit_price > 0 THEN
      ROUND(
        (sol.unit_price - COALESCE(su.landed_cost, 0))
        / sol.unit_price * 100,
        2
      )
    ELSE NULL
  END                                                                 AS gross_margin_pct,

  -- Fee burden % (fees as share of revenue)
  CASE
    WHEN sol.unit_price > 0 THEN
      ROUND(
        COALESCE(oft.total_fees / NULLIF(ouc.unit_count, 0), 0)
        / sol.unit_price * 100,
        2
      )
    ELSE NULL
  END                                                                 AS fee_pct

FROM public.sales_order_line sol
JOIN public.stock_unit su
  ON su.id = sol.stock_unit_id
LEFT JOIN order_unit_counts ouc
  ON ouc.sales_order_id = sol.sales_order_id
LEFT JOIN order_fee_totals oft
  ON oft.sales_order_id = sol.sales_order_id
WHERE sol.stock_unit_id IS NOT NULL;

COMMENT ON VIEW public.unit_profit_view IS
  'Per-unit profit and margin analysis. '
  'Joins stock_unit landed cost with sales_order_line revenue and payout_fee channel fees. '
  'Requires payout_fee rows to be populated (by ebay-import-payouts Edge Function) '
  'for fee columns to be non-zero. Units without payout_fee data show gross margin only.';

-- Grant read access to authenticated admin users
GRANT SELECT ON public.unit_profit_view TO authenticated;

-- ─── 7. Late-match helper function ───────────────────────────────────────────
-- After an eBay order is imported into sales_order, call this to retroactively
-- link any payout_fee rows that arrived before the order record existed.

CREATE OR REPLACE FUNCTION public.v2_link_unmatched_payout_fees()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.payout_fee pf
  SET
    sales_order_id = so.id,
    updated_at     = now()
  FROM public.sales_order so
  WHERE pf.sales_order_id IS NULL
    AND pf.external_order_id IS NOT NULL
    AND so.external_order_id = pf.external_order_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION public.v2_link_unmatched_payout_fees() IS
  'Retroactively links payout_fee rows to sales_order records '
  'when the fee arrived before the order was imported. '
  'Returns the number of rows updated. '
  'Call after any bulk eBay order import.';
