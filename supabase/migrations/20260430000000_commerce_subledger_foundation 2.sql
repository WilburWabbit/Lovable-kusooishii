-- ============================================================
-- Commerce Subledger Foundation
--
-- Additive implementation of the target pricing, costing,
-- accounting, Blue Bell, settlement, and market-signal architecture.
--
-- This migration deliberately keeps legacy v2 columns and functions
-- in place. New writes can move onto these structures gradually while
-- existing admin screens continue to read compatibility fields/views.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Shared helpers
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.subledger_staff_read_policy()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. Sales Program Foundation
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_program (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  default_discount_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  default_commission_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_program_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_program_id UUID NOT NULL REFERENCES public.sales_program(id) ON DELETE CASCADE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  discount_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  discount_basis TEXT NOT NULL DEFAULT 'merchandise_subtotal'
    CHECK (discount_basis IN ('merchandise_subtotal', 'website_merchandise_price', 'manual')),
  commission_basis TEXT NOT NULL DEFAULT 'post_discount_merchandise_subtotal'
    CHECK (commission_basis IN ('post_discount_merchandise_subtotal', 'gross_total', 'manual')),
  currency TEXT NOT NULL DEFAULT 'GBP',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS public.sales_program_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES public.sales_order(id) ON DELETE CASCADE,
  sales_program_id UUID NOT NULL REFERENCES public.sales_program(id),
  attribution_source TEXT NOT NULL
    CHECK (attribution_source IN (
      'checkout_shipping_method',
      'staff_checkbox',
      'legacy_backfill',
      'admin_correction',
      'system'
    )),
  attribution_reason TEXT,
  locked_at TIMESTAMPTZ,
  corrected_from_attribution_id UUID REFERENCES public.sales_program_attribution(id),
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sales_order_id, sales_program_id)
);

CREATE TABLE IF NOT EXISTS public.sales_program_settlement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_program_id UUID NOT NULL REFERENCES public.sales_program(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posted', 'paid', 'void')),
  gross_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  reversed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  qbo_expense_id TEXT,
  qbo_payment_reference TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.sales_program_accrual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_program_id UUID NOT NULL REFERENCES public.sales_program(id),
  sales_order_id UUID NOT NULL REFERENCES public.sales_order(id) ON DELETE CASCADE,
  attribution_id UUID REFERENCES public.sales_program_attribution(id),
  settlement_id UUID REFERENCES public.sales_program_settlement(id),
  accrual_type TEXT NOT NULL DEFAULT 'commission'
    CHECK (accrual_type IN ('commission', 'discount', 'reversal')),
  basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  reversed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partially_settled', 'settled', 'reversed', 'void')),
  source TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sales_program_id, sales_order_id, accrual_type)
);

ALTER TABLE public.sales_program ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_program_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_program_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_program_accrual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_program_settlement ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_program_staff_all" ON public.sales_program
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "sales_program_rule_staff_all" ON public.sales_program_rule
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "sales_program_attribution_staff_all" ON public.sales_program_attribution
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "sales_program_accrual_staff_all" ON public.sales_program_accrual
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "sales_program_settlement_staff_all" ON public.sales_program_settlement
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_sales_program_updated_at
  BEFORE UPDATE ON public.sales_program
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_sales_program_rule_updated_at
  BEFORE UPDATE ON public.sales_program_rule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_sales_program_accrual_updated_at
  BEFORE UPDATE ON public.sales_program_accrual
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_sales_program_settlement_updated_at
  BEFORE UPDATE ON public.sales_program_settlement
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_sales_program_attribution_order
  ON public.sales_program_attribution(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_program_accrual_order
  ON public.sales_program_accrual(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_program_accrual_open
  ON public.sales_program_accrual(sales_program_id, status)
  WHERE status IN ('open', 'partially_settled');

INSERT INTO public.sales_program (
  program_code,
  name,
  status,
  default_discount_rate,
  default_commission_rate,
  metadata
)
VALUES (
  'blue_bell',
  'Blue Bell LEGO Club',
  'active',
  0.05,
  0.05,
  jsonb_build_object('collection_program', true, 'venue', 'Blue Bell Pub')
)
ON CONFLICT (program_code) DO UPDATE
SET default_discount_rate = EXCLUDED.default_discount_rate,
    default_commission_rate = EXCLUDED.default_commission_rate,
    updated_at = now();

INSERT INTO public.sales_program_rule (
  sales_program_id,
  effective_from,
  discount_rate,
  commission_rate,
  discount_basis,
  commission_basis,
  currency,
  active
)
SELECT
  sp.id,
  COALESCE(
    (SELECT MIN(so.created_at) FROM public.sales_order so WHERE COALESCE(so.blue_bell_club, false) = true),
    '2026-01-01'::timestamptz
  ),
  0.05,
  0.05,
       'website_merchandise_price', 'post_discount_merchandise_subtotal', 'GBP', true
FROM public.sales_program sp
WHERE sp.program_code = 'blue_bell'
  AND NOT EXISTS (
    SELECT 1 FROM public.sales_program_rule r
    WHERE r.sales_program_id = sp.id AND r.active = true
  );

INSERT INTO public.sales_program_attribution (
  sales_order_id,
  sales_program_id,
  attribution_source,
  attribution_reason,
  locked_at,
  created_at
)
SELECT so.id, sp.id, 'legacy_backfill',
       'Backfilled from sales_order.blue_bell_club',
       so.created_at,
       so.created_at
FROM public.sales_order so
JOIN public.sales_program sp ON sp.program_code = 'blue_bell'
WHERE COALESCE(so.blue_bell_club, false) = true
ON CONFLICT (sales_order_id, sales_program_id) DO NOTHING;

INSERT INTO public.sales_program_accrual (
  sales_program_id,
  sales_order_id,
  attribution_id,
  accrual_type,
  basis_amount,
  discount_amount,
  commission_amount,
  currency,
  status,
  source,
  metadata,
  created_at
)
SELECT
  spa.sales_program_id,
  so.id,
  spa.id,
  'commission',
  ROUND(GREATEST(
    COALESCE(so.merchandise_subtotal, so.gross_total, 0)
    - COALESCE(NULLIF(so.discount_total, 0), so.club_discount_amount, 0),
    0
  ), 2) AS basis_amount,
  ROUND(COALESCE(NULLIF(so.club_discount_amount, 0), COALESCE(so.merchandise_subtotal, 0) * 0.05), 2),
  ROUND(COALESCE(
    NULLIF(so.club_commission_amount, 0),
    GREATEST(
      COALESCE(so.merchandise_subtotal, so.gross_total, 0)
      - COALESCE(NULLIF(so.discount_total, 0), so.club_discount_amount, 0),
      0
    ) * 0.05
  ), 2),
  COALESCE(so.currency, 'GBP'),
  'open',
  'legacy_backfill',
  jsonb_build_object('legacy_blue_bell_club', true),
  so.created_at
FROM public.sales_order so
JOIN public.sales_program_attribution spa ON spa.sales_order_id = so.id
JOIN public.sales_program sp ON sp.id = spa.sales_program_id AND sp.program_code = 'blue_bell'
WHERE COALESCE(so.blue_bell_club, false) = true
ON CONFLICT (sales_program_id, sales_order_id, accrual_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. Pricing Policy And Decision Snapshots
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.price_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  minimum_margin_rate NUMERIC(8,6) NOT NULL DEFAULT 0.25,
  minimum_profit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  risk_reserve_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  first_markdown_days INTEGER NOT NULL DEFAULT 30,
  first_markdown_rate NUMERIC(8,6) NOT NULL DEFAULT 0.10,
  clearance_markdown_days INTEGER NOT NULL DEFAULT 45,
  clearance_markdown_rate NUMERIC(8,6) NOT NULL DEFAULT 0.20,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channel_price_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_policy_id UUID NOT NULL REFERENCES public.price_policy(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  minimum_margin_rate NUMERIC(8,6),
  minimum_profit_amount NUMERIC(12,2),
  default_packaging_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  default_delivery_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_fee_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  marketplace_fee_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  advertising_fee_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
  fixed_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (price_policy_id, channel)
);

CREATE TABLE IF NOT EXISTS public.pricing_fee_component (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_price_policy_id UUID REFERENCES public.channel_price_policy(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  fee_name TEXT NOT NULL,
  fee_category TEXT NOT NULL DEFAULT 'selling_fee'
    CHECK (fee_category IN ('selling_fee', 'payment_processing', 'advertising', 'shipping', 'packaging', 'risk_reserve', 'program_commission', 'other')),
  rate_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  fixed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  applies_to TEXT NOT NULL DEFAULT 'sale_price',
  active BOOLEAN NOT NULL DEFAULT true,
  source_table TEXT,
  source_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.price_decision_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES public.sku(id),
  channel_listing_id UUID REFERENCES public.channel_listing(id) ON DELETE SET NULL,
  price_policy_id UUID REFERENCES public.price_policy(id),
  channel_price_policy_id UUID REFERENCES public.channel_price_policy(id),
  sales_program_id UUID REFERENCES public.sales_program(id),
  channel TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  candidate_price NUMERIC(12,2),
  current_price NUMERIC(12,2),
  floor_price NUMERIC(12,2),
  target_price NUMERIC(12,2),
  ceiling_price NUMERIC(12,2),
  market_consensus_price NUMERIC(12,2),
  carrying_value_basis NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_program_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_program_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_net_before_cogs NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_margin_amount NUMERIC(12,2),
  expected_margin_rate NUMERIC(8,6),
  confidence_score NUMERIC(8,6) NOT NULL DEFAULT 0.5,
  source_divergence_score NUMERIC(8,6),
  freshness_score NUMERIC(8,6),
  recommendation TEXT NOT NULL DEFAULT 'hold'
    CHECK (recommendation IN ('publish', 'reprice_up', 'reprice_down', 'hold', 'review', 'suppress')),
  blocking_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_required BOOLEAN NOT NULL DEFAULT false,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_version TEXT NOT NULL DEFAULT 'subledger_v1',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.price_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_decision_snapshot_id UUID REFERENCES public.price_decision_snapshot(id) ON DELETE SET NULL,
  sku_id UUID NOT NULL REFERENCES public.sku(id),
  channel_listing_id UUID REFERENCES public.channel_listing(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('below_floor', 'manual_price', 'margin_exception')),
  old_price NUMERIC(12,2),
  new_price NUMERIC(12,2) NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  approved_by UUID,
  performed_by UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.price_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_price_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_fee_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_decision_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_override ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_policy_staff_all" ON public.price_policy
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "channel_price_policy_staff_all" ON public.channel_price_policy
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "pricing_fee_component_staff_all" ON public.pricing_fee_component
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "price_decision_snapshot_staff_all" ON public.price_decision_snapshot
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "price_override_staff_all" ON public.price_override
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_price_policy_updated_at
  BEFORE UPDATE ON public.price_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_channel_price_policy_updated_at
  BEFORE UPDATE ON public.channel_price_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_pricing_fee_component_updated_at
  BEFORE UPDATE ON public.pricing_fee_component
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_price_decision_snapshot_sku_channel
  ON public.price_decision_snapshot(sku_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_decision_snapshot_listing
  ON public.price_decision_snapshot(channel_listing_id, created_at DESC)
  WHERE channel_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_override_sku_channel
  ON public.price_override(sku_id, channel, created_at DESC);

INSERT INTO public.price_policy (
  policy_code,
  name,
  status,
  minimum_margin_rate,
  first_markdown_days,
  first_markdown_rate,
  clearance_markdown_days,
  clearance_markdown_rate,
  risk_reserve_rate,
  metadata
)
SELECT
  'default',
  'Default Channel-Net Pricing Policy',
  'active',
  COALESCE((SELECT value FROM public.pricing_settings WHERE key = 'minimum_margin_target'), 0.25),
  COALESCE((SELECT value::integer FROM public.pricing_settings WHERE key = 'first_markdown_days'), 30),
  COALESCE((SELECT value FROM public.pricing_settings WHERE key = 'first_markdown_pct'), 0.10),
  COALESCE((SELECT value::integer FROM public.pricing_settings WHERE key = 'clearance_markdown_days'), 45),
  COALESCE((SELECT value FROM public.pricing_settings WHERE key = 'clearance_markdown_pct'), 0.20),
  COALESCE((SELECT value / 100 FROM public.selling_cost_defaults WHERE key = 'risk_reserve_rate'), 0),
  jsonb_build_object('seeded_from', 'pricing_settings')
ON CONFLICT (policy_code) DO UPDATE
SET minimum_margin_rate = EXCLUDED.minimum_margin_rate,
    first_markdown_days = EXCLUDED.first_markdown_days,
    first_markdown_rate = EXCLUDED.first_markdown_rate,
    clearance_markdown_days = EXCLUDED.clearance_markdown_days,
    clearance_markdown_rate = EXCLUDED.clearance_markdown_rate,
    risk_reserve_rate = EXCLUDED.risk_reserve_rate,
    updated_at = now();

INSERT INTO public.channel_price_policy (
  price_policy_id,
  channel,
  default_packaging_cost,
  default_delivery_cost,
  marketplace_fee_rate,
  payment_fee_rate,
  advertising_fee_rate,
  fixed_fee_amount,
  metadata
)
SELECT
  pp.id,
  ch.channel,
  COALESCE((SELECT value FROM public.selling_cost_defaults WHERE key = 'packaging_cost'), 0),
  COALESCE((SELECT MIN(cost) FROM public.shipping_rate_table srt WHERE srt.active = true AND (srt.channel = ch.channel OR srt.channel = 'default')), 0),
  COALESCE(SUM(cfs.rate_percent) FILTER (WHERE cfs.fee_name !~* 'stripe|processing|payment|promoted|ad') / 100, 0),
  COALESCE(SUM(cfs.rate_percent) FILTER (WHERE cfs.fee_name ~* 'stripe|processing|payment') / 100, 0),
  COALESCE(SUM(cfs.rate_percent) FILTER (WHERE cfs.fee_name ~* 'promoted|ad') / 100, 0),
  COALESCE(SUM(cfs.fixed_amount), 0),
  jsonb_build_object('seeded_from', 'channel_fee_schedule')
FROM public.price_policy pp
CROSS JOIN (
  VALUES ('website'), ('web'), ('ebay'), ('bricklink'), ('brickowl'), ('in_person')
) AS ch(channel)
LEFT JOIN public.channel_fee_schedule cfs
  ON cfs.active = true
 AND (cfs.channel = ch.channel OR (ch.channel = 'website' AND cfs.channel = 'web'))
WHERE pp.policy_code = 'default'
GROUP BY pp.id, ch.channel
ON CONFLICT (price_policy_id, channel) DO UPDATE
SET default_packaging_cost = EXCLUDED.default_packaging_cost,
    default_delivery_cost = EXCLUDED.default_delivery_cost,
    marketplace_fee_rate = EXCLUDED.marketplace_fee_rate,
    payment_fee_rate = EXCLUDED.payment_fee_rate,
    advertising_fee_rate = EXCLUDED.advertising_fee_rate,
    fixed_fee_amount = EXCLUDED.fixed_fee_amount,
    updated_at = now();

INSERT INTO public.pricing_fee_component (
  channel_price_policy_id,
  channel,
  fee_name,
  fee_category,
  rate_percent,
  fixed_amount,
  applies_to,
  active,
  source_table,
  source_id,
  notes
)
SELECT
  cpp.id,
  cpp.channel,
  cfs.fee_name,
  CASE
    WHEN cfs.fee_name ~* 'stripe|processing|payment' THEN 'payment_processing'
    WHEN cfs.fee_name ~* 'promoted|ad' THEN 'advertising'
    ELSE 'selling_fee'
  END,
  cfs.rate_percent,
  cfs.fixed_amount,
  cfs.applies_to,
  cfs.active,
  'channel_fee_schedule',
  cfs.id,
  cfs.notes
FROM public.channel_price_policy cpp
JOIN public.channel_fee_schedule cfs
  ON cfs.channel = cpp.channel OR (cpp.channel = 'website' AND cfs.channel = 'web')
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_fee_component pfc
  WHERE pfc.source_table = 'channel_fee_schedule'
    AND pfc.source_id = cfs.id
    AND pfc.channel_price_policy_id = cpp.id
);

ALTER TABLE public.channel_listing
  ADD COLUMN IF NOT EXISTS current_price_decision_snapshot_id UUID REFERENCES public.price_decision_snapshot(id);

WITH sku_cost AS (
  SELECT
    su.sku_id,
    ROUND(MAX(COALESCE(su.carrying_value, su.landed_cost, 0)), 2) AS max_carrying_value
  FROM public.stock_unit su
  WHERE COALESCE(su.v2_status::text, su.status::text) IN ('graded', 'listed', 'available', 'reserved')
  GROUP BY su.sku_id
),
listing_source AS (
  SELECT
    cl.id AS listing_id,
    cl.sku_id,
    COALESCE(NULLIF(cl.channel, ''), cl.v2_channel::text, 'website') AS channel,
    COALESCE(cl.listed_price, sk.price, sk.sale_price, 0) AS current_price,
    COALESCE(sk.floor_price, 0) AS legacy_floor,
    COALESCE(sk.market_price, sk.price, sk.sale_price, cl.listed_price, 0) AS target_price,
    COALESCE(cl.estimated_fees, 0) AS estimated_fees,
    COALESCE(cl.estimated_net, COALESCE(cl.listed_price, sk.price, sk.sale_price, 0) - COALESCE(cl.estimated_fees, 0)) AS estimated_net,
    COALESCE(sc.max_carrying_value, 0) AS carrying_value_basis
  FROM public.channel_listing cl
  JOIN public.sku sk ON sk.id = cl.sku_id
  LEFT JOIN sku_cost sc ON sc.sku_id = cl.sku_id
  WHERE cl.sku_id IS NOT NULL
),
inserted AS (
  INSERT INTO public.price_decision_snapshot (
    sku_id,
    channel_listing_id,
    price_policy_id,
    channel_price_policy_id,
    channel,
    currency,
    candidate_price,
    current_price,
    floor_price,
    target_price,
    ceiling_price,
    market_consensus_price,
    carrying_value_basis,
    estimated_fees,
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
    created_at
  )
  SELECT
    ls.sku_id,
    ls.listing_id,
    pp.id,
    cpp.id,
    ls.channel,
    'GBP',
    ls.current_price,
    ls.current_price,
    ls.legacy_floor,
    ls.target_price,
    GREATEST(ls.legacy_floor, ls.target_price),
    ls.target_price,
    ls.carrying_value_basis,
    ls.estimated_fees,
    ls.current_price,
    ls.estimated_net,
    ROUND(ls.current_price - ls.estimated_fees - ls.carrying_value_basis, 2),
    CASE WHEN ls.current_price > 0 THEN ROUND((ls.current_price - ls.estimated_fees - ls.carrying_value_basis) / ls.current_price, 6) ELSE NULL END,
    0.50,
    CASE WHEN ls.legacy_floor > 0 AND ls.current_price < ls.legacy_floor THEN 'review' ELSE 'hold' END,
    CASE WHEN ls.legacy_floor > 0 AND ls.current_price < ls.legacy_floor THEN jsonb_build_array('below_legacy_floor') ELSE '[]'::jsonb END,
    (ls.legacy_floor > 0 AND ls.current_price < ls.legacy_floor),
    jsonb_build_object('backfill', true, 'legacy_floor_price', ls.legacy_floor),
    'legacy_backfill_v1',
    now()
  FROM listing_source ls
  JOIN public.price_policy pp ON pp.policy_code = 'default'
  LEFT JOIN public.channel_price_policy cpp ON cpp.price_policy_id = pp.id AND cpp.channel = ls.channel
  WHERE NOT EXISTS (
    SELECT 1 FROM public.price_decision_snapshot pds
    WHERE pds.channel_listing_id = ls.listing_id
      AND pds.calculation_version = 'legacy_backfill_v1'
  )
  RETURNING id, channel_listing_id
)
UPDATE public.channel_listing cl
SET current_price_decision_snapshot_id = inserted.id
FROM inserted
WHERE cl.id = inserted.channel_listing_id
  AND cl.current_price_decision_snapshot_id IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Order-Line Economics
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.sales_order_line
  ADD COLUMN IF NOT EXISTS costing_method TEXT,
  ADD COLUMN IF NOT EXISTS cogs_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cogs_source_unit_id UUID REFERENCES public.stock_unit(id),
  ADD COLUMN IF NOT EXISTS price_decision_snapshot_id UUID REFERENCES public.price_decision_snapshot(id),
  ADD COLUMN IF NOT EXISTS fee_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS program_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS program_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_margin_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS net_margin_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS net_margin_rate NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS economics_status TEXT NOT NULL DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_sales_order_line_economics_status
  ON public.sales_order_line(economics_status);
CREATE INDEX IF NOT EXISTS idx_sales_order_line_cogs_source
  ON public.sales_order_line(cogs_source_unit_id)
  WHERE cogs_source_unit_id IS NOT NULL;

UPDATE public.sales_order_line sol
SET costing_method = CASE
      WHEN sol.stock_unit_id IS NOT NULL THEN 'specific_unit'
      ELSE COALESCE(sol.costing_method, 'manual_exception')
    END,
    cogs_amount = COALESCE(sol.cogs_amount, sol.cogs, su.carrying_value, su.landed_cost),
    cogs_source_unit_id = COALESCE(sol.cogs_source_unit_id, sol.stock_unit_id),
    economics_status = CASE
      WHEN sol.stock_unit_id IS NULL OR COALESCE(sol.cogs_amount, sol.cogs, su.carrying_value, su.landed_cost) IS NULL THEN 'needs_allocation'
      ELSE 'final'
    END
FROM public.stock_unit su
WHERE su.id = sol.stock_unit_id;

UPDATE public.sales_order_line sol
SET costing_method = COALESCE(sol.costing_method, 'manual_exception'),
    economics_status = 'needs_allocation'
WHERE sol.stock_unit_id IS NULL
  AND sol.economics_status = 'draft';

WITH order_unit_counts AS (
  SELECT sales_order_id, COUNT(*)::numeric AS line_count
  FROM public.sales_order_line
  GROUP BY sales_order_id
),
order_fee_totals AS (
  SELECT
    pf.sales_order_id,
    SUM(pf.amount) AS total_fee_amount,
    jsonb_object_agg(pf.fee_category, pf.amount_sum) AS fee_by_category
  FROM (
    SELECT sales_order_id, fee_category, SUM(amount) AS amount, SUM(amount) AS amount_sum
    FROM public.payout_fee
    WHERE sales_order_id IS NOT NULL
    GROUP BY sales_order_id, fee_category
  ) pf
  GROUP BY pf.sales_order_id
),
program_totals AS (
  SELECT
    spa.sales_order_id,
    SUM(spa.discount_amount) AS discount_amount,
    SUM(spa.commission_amount - spa.reversed_amount) AS commission_amount
  FROM public.sales_program_accrual spa
  GROUP BY spa.sales_order_id
)
UPDATE public.sales_order_line sol
SET fee_snapshot = jsonb_build_object(
      'source',
      CASE WHEN oft.sales_order_id IS NOT NULL THEN 'actual_payout_fee' ELSE 'estimated_missing_actual' END,
      'total_fee_amount',
      ROUND(COALESCE(oft.total_fee_amount / NULLIF(ouc.line_count, 0), 0), 4),
      'fee_by_category',
      COALESCE(oft.fee_by_category, '{}'::jsonb)
    ),
    program_discount_amount = ROUND(COALESCE(pt.discount_amount / NULLIF(ouc.line_count, 0), 0), 2),
    program_commission_amount = ROUND(COALESCE(pt.commission_amount / NULLIF(ouc.line_count, 0), 0), 2)
FROM order_unit_counts ouc
LEFT JOIN order_fee_totals oft ON oft.sales_order_id = ouc.sales_order_id
LEFT JOIN program_totals pt ON pt.sales_order_id = ouc.sales_order_id
WHERE sol.sales_order_id = ouc.sales_order_id;

UPDATE public.sales_order_line sol
SET gross_margin_amount = ROUND(COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0) - COALESCE(sol.cogs_amount, 0), 2),
    net_margin_amount = ROUND(
      COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0)
      - COALESCE(sol.cogs_amount, 0)
      - COALESCE((sol.fee_snapshot->>'total_fee_amount')::numeric, 0)
      - COALESCE(sol.program_commission_amount, 0),
      2
    ),
    net_margin_rate = CASE
      WHEN COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0) > 0 THEN ROUND((
        COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0)
        - COALESCE(sol.cogs_amount, 0)
        - COALESCE((sol.fee_snapshot->>'total_fee_amount')::numeric, 0)
        - COALESCE(sol.program_commission_amount, 0)
      ) / COALESCE(sol.line_total, sol.unit_price * sol.quantity, 0), 6)
      ELSE NULL
    END;

-- ─────────────────────────────────────────────────────────────
-- 4. Allocation And Cost Event Ledger
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_allocation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE CASCADE,
  sales_order_line_id UUID REFERENCES public.sales_order_line(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES public.sku(id),
  requested_stock_unit_id UUID REFERENCES public.stock_unit(id),
  selected_stock_unit_id UUID REFERENCES public.stock_unit(id),
  allocation_method TEXT NOT NULL
    CHECK (allocation_method IN ('specific_unit', 'fifo_fallback', 'manual_exception', 'legacy_backfill')),
  allocation_source TEXT NOT NULL DEFAULT 'system',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'allocated'
    CHECK (status IN ('pending', 'allocated', 'released', 'failed', 'void')),
  failure_reason TEXT,
  actor_id UUID,
  allocated_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_cost_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_unit_id UUID REFERENCES public.stock_unit(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE SET NULL,
  sales_order_line_id UUID REFERENCES public.sales_order_line(id) ON DELETE SET NULL,
  stock_allocation_id UUID REFERENCES public.stock_allocation(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'receipt',
      'regrade_reallocation',
      'impairment',
      'sale_cogs',
      'return_reversal',
      'write_off',
      'scrap_sale',
      'part_out_transfer',
      'manual_correction'
    )),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  costing_method TEXT CHECK (costing_method IN ('specific_unit', 'fifo_fallback', 'manual_exception', 'legacy_backfill')),
  carrying_value_before NUMERIC(12,2),
  carrying_value_after NUMERIC(12,2),
  source TEXT NOT NULL DEFAULT 'system',
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_cost_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_allocation_staff_all" ON public.stock_allocation
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "stock_cost_event_staff_all" ON public.stock_cost_event
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_stock_allocation_updated_at
  BEFORE UPDATE ON public.stock_allocation
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_stock_allocation_line
  ON public.stock_allocation(sales_order_line_id);
CREATE INDEX IF NOT EXISTS idx_stock_allocation_unit
  ON public.stock_allocation(selected_stock_unit_id)
  WHERE selected_stock_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_cost_event_unit
  ON public.stock_cost_event(stock_unit_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_unit_fifo_subledger
  ON public.stock_unit(sku_id, v2_status, created_at ASC)
  WHERE v2_status IN ('graded', 'listed', 'restocked');

INSERT INTO public.stock_allocation (
  sales_order_id,
  sales_order_line_id,
  sku_id,
  requested_stock_unit_id,
  selected_stock_unit_id,
  allocation_method,
  allocation_source,
  idempotency_key,
  status,
  allocated_at,
  created_at
)
SELECT
  sol.sales_order_id,
  sol.id,
  sol.sku_id,
  sol.stock_unit_id,
  sol.stock_unit_id,
  'legacy_backfill',
  'legacy_backfill',
  'sale_line:' || sol.id::text,
  'allocated',
  COALESCE(su.sold_at, so.created_at, sol.created_at),
  COALESCE(so.created_at, sol.created_at)
FROM public.sales_order_line sol
JOIN public.sales_order so ON so.id = sol.sales_order_id
JOIN public.stock_unit su ON su.id = sol.stock_unit_id
WHERE sol.stock_unit_id IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.stock_cost_event (
  stock_unit_id,
  event_type,
  amount,
  currency,
  costing_method,
  carrying_value_after,
  source,
  idempotency_key,
  metadata,
  event_at,
  created_at
)
SELECT
  su.id,
  'receipt',
  COALESCE(su.landed_cost, 0),
  'GBP',
  'legacy_backfill',
  COALESCE(su.carrying_value, su.landed_cost, 0),
  'legacy_backfill',
  'stock_receipt:' || su.id::text,
  jsonb_build_object('batch_id', su.batch_id, 'line_item_id', su.line_item_id),
  su.created_at,
  su.created_at
FROM public.stock_unit su
WHERE su.landed_cost IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.stock_cost_event (
  stock_unit_id,
  sales_order_id,
  sales_order_line_id,
  stock_allocation_id,
  event_type,
  amount,
  currency,
  costing_method,
  carrying_value_before,
  carrying_value_after,
  source,
  idempotency_key,
  metadata,
  event_at,
  created_at
)
SELECT
  sol.stock_unit_id,
  sol.sales_order_id,
  sol.id,
  sa.id,
  'sale_cogs',
  COALESCE(sol.cogs_amount, sol.cogs, su.carrying_value, su.landed_cost, 0),
  COALESCE(so.currency, 'GBP'),
  COALESCE(sol.costing_method, 'legacy_backfill'),
  COALESCE(su.carrying_value, su.landed_cost, 0),
  0,
  'legacy_backfill',
  'sale_cogs:' || sol.id::text,
  jsonb_build_object('legacy_cogs', sol.cogs),
  COALESCE(su.sold_at, so.created_at, sol.created_at),
  COALESCE(so.created_at, sol.created_at)
FROM public.sales_order_line sol
JOIN public.sales_order so ON so.id = sol.sales_order_id
JOIN public.stock_unit su ON su.id = sol.stock_unit_id
LEFT JOIN public.stock_allocation sa ON sa.sales_order_line_id = sol.id
WHERE sol.stock_unit_id IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. Accounting Event And QBO Posting Outbox
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounting_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'revenue',
      'vat',
      'discount',
      'cogs',
      'shipping_income',
      'fee_expense',
      'commission_expense',
      'commission_payable',
      'refund',
      'payout_clearing',
      'write_off',
      'impairment',
      'settlement_adjustment'
    )),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE SET NULL,
  sales_order_line_id UUID REFERENCES public.sales_order_line(id) ON DELETE SET NULL,
  stock_unit_id UUID REFERENCES public.stock_unit(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  debit_account_purpose TEXT,
  credit_account_purpose TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'void', 'reversed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.posting_intent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_system TEXT NOT NULL DEFAULT 'qbo',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'posted', 'failed', 'skipped', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  qbo_reference_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_system, action, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.qbo_posting_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_entity_type TEXT NOT NULL,
  local_entity_id UUID,
  qbo_entity_type TEXT NOT NULL,
  qbo_entity_id TEXT NOT NULL,
  qbo_doc_number TEXT,
  source_column TEXT,
  posting_intent_id UUID REFERENCES public.posting_intent(id) ON DELETE SET NULL,
  raw_landing_table TEXT,
  raw_landing_id UUID,
  synced_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id)
);

ALTER TABLE public.accounting_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posting_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_posting_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounting_event_staff_all" ON public.accounting_event
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "posting_intent_staff_all" ON public.posting_intent
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "qbo_posting_reference_staff_all" ON public.qbo_posting_reference
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_posting_intent_updated_at
  BEFORE UPDATE ON public.posting_intent
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_accounting_event_order
  ON public.accounting_event(sales_order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_posting_intent_pending
  ON public.posting_intent(target_system, status, next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_qbo_posting_reference_local
  ON public.qbo_posting_reference(local_entity_type, local_entity_id);

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  credit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'revenue', 'sales_order', so.id, so.id, COALESCE(so.net_amount, so.gross_total - so.tax_total, so.gross_total, 0),
       COALESCE(so.currency, 'GBP'), 'sales_revenue', 'legacy_backfill', 'order_revenue:' || so.id::text, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.gross_total, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  credit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'vat', 'sales_order', so.id, so.id, COALESCE(NULLIF(so.tax_total, 0), so.vat_amount, 0),
       COALESCE(so.currency, 'GBP'), 'vat_payable', 'legacy_backfill', 'order_vat:' || so.id::text, so.created_at
FROM public.sales_order so
WHERE COALESCE(NULLIF(so.tax_total, 0), so.vat_amount, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  debit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'discount', 'sales_order', so.id, so.id, COALESCE(so.discount_total, so.club_discount_amount, 0),
       COALESCE(so.currency, 'GBP'), 'sales_discounts', 'legacy_backfill', 'order_discount:' || so.id::text, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.discount_total, so.club_discount_amount, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  credit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'shipping_income', 'sales_order', so.id, so.id, COALESCE(so.shipping_total, 0),
       COALESCE(so.currency, 'GBP'), 'shipping_income', 'legacy_backfill', 'order_shipping:' || so.id::text, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.shipping_total, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  sales_order_line_id,
  stock_unit_id,
  amount,
  currency,
  debit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'cogs', 'sales_order_line', sol.id, sol.sales_order_id, sol.id, sol.stock_unit_id,
       COALESCE(sol.cogs_amount, sol.cogs, 0),
       COALESCE(so.currency, 'GBP'),
       'cost_of_goods_sold',
       'legacy_backfill',
       'line_cogs:' || sol.id::text,
       COALESCE(so.created_at, sol.created_at)
FROM public.sales_order_line sol
JOIN public.sales_order so ON so.id = sol.sales_order_id
WHERE COALESCE(sol.cogs_amount, sol.cogs, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  debit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'fee_expense', 'sales_order', pf.sales_order_id, pf.sales_order_id, SUM(pf.amount),
       'GBP', 'channel_fee_expense', 'legacy_backfill',
       'order_fees:' || pf.sales_order_id::text,
       MIN(pf.created_at)
FROM public.payout_fee pf
WHERE pf.sales_order_id IS NOT NULL
GROUP BY pf.sales_order_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.accounting_event (
  event_type,
  entity_type,
  entity_id,
  sales_order_id,
  amount,
  currency,
  debit_account_purpose,
  credit_account_purpose,
  source,
  idempotency_key,
  occurred_at
)
SELECT 'commission_expense', 'sales_program_accrual', spa.id, spa.sales_order_id,
       spa.commission_amount - spa.reversed_amount,
       spa.currency,
       'club_commission_expense',
       'club_commission_payable',
       'legacy_backfill',
       'program_commission:' || spa.id::text,
       spa.created_at
FROM public.sales_program_accrual spa
WHERE spa.accrual_type = 'commission'
  AND spa.commission_amount - spa.reversed_amount <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.qbo_posting_reference (
  local_entity_type,
  local_entity_id,
  qbo_entity_type,
  qbo_entity_id,
  source_column,
  synced_at,
  metadata
)
SELECT 'sales_order', so.id, 'SalesReceipt', so.qbo_sales_receipt_id,
       'sales_order.qbo_sales_receipt_id',
       COALESCE(so.qbo_last_attempt_at, so.updated_at, so.created_at),
       jsonb_build_object('qbo_sync_status', so.qbo_sync_status)
FROM public.sales_order so
WHERE so.qbo_sales_receipt_id IS NOT NULL
ON CONFLICT (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id) DO NOTHING;

INSERT INTO public.qbo_posting_reference (
  local_entity_type,
  local_entity_id,
  qbo_entity_type,
  qbo_entity_id,
  source_column,
  synced_at
)
SELECT 'customer', c.id, 'Customer', c.qbo_customer_id,
       'customer.qbo_customer_id',
       c.synced_at
FROM public.customer c
WHERE c.qbo_customer_id IS NOT NULL
ON CONFLICT (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id) DO NOTHING;

INSERT INTO public.qbo_posting_reference (
  local_entity_type,
  local_entity_id,
  qbo_entity_type,
  qbo_entity_id,
  source_column,
  synced_at
)
SELECT 'sku', sk.id, 'Item', sk.qbo_item_id,
       'sku.qbo_item_id',
       sk.updated_at
FROM public.sku sk
WHERE sk.qbo_item_id IS NOT NULL
ON CONFLICT (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id) DO NOTHING;

INSERT INTO public.qbo_posting_reference (
  local_entity_type,
  local_entity_id,
  qbo_entity_type,
  qbo_entity_id,
  source_column,
  synced_at
)
SELECT 'payout', p.id, 'Deposit', p.qbo_deposit_id,
       'payouts.qbo_deposit_id',
       p.updated_at
FROM public.payouts p
WHERE p.qbo_deposit_id IS NOT NULL
ON CONFLICT (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id) DO NOTHING;

INSERT INTO public.qbo_posting_reference (
  local_entity_type,
  local_entity_id,
  qbo_entity_type,
  qbo_entity_id,
  source_column,
  synced_at
)
SELECT 'payout', p.id, 'Expense', p.qbo_expense_id,
       'payouts.qbo_expense_id',
       p.updated_at
FROM public.payouts p
WHERE p.qbo_expense_id IS NOT NULL
ON CONFLICT (local_entity_type, local_entity_id, qbo_entity_type, qbo_entity_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6. Expected And Actual Settlement
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expected_settlement_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE CASCADE,
  sales_order_line_id UUID REFERENCES public.sales_order_line(id) ON DELETE CASCADE,
  sales_program_accrual_id UUID REFERENCES public.sales_program_accrual(id) ON DELETE SET NULL,
  category TEXT NOT NULL
    CHECK (category IN ('gross', 'tax', 'discount', 'shipping', 'fee', 'refund', 'commission', 'net')),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  source TEXT NOT NULL DEFAULT 'order_economics',
  confidence TEXT NOT NULL DEFAULT 'actual'
    CHECK (confidence IN ('actual', 'estimated', 'manual')),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.actual_settlement_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID REFERENCES public.payouts(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE SET NULL,
  payout_fee_id UUID REFERENCES public.payout_fee(id) ON DELETE SET NULL,
  qbo_posting_reference_id UUID REFERENCES public.qbo_posting_reference(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('gross', 'tax', 'discount', 'shipping', 'fee', 'refund', 'commission', 'net', 'deposit')),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  external_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_case (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type TEXT NOT NULL
    CHECK (case_type IN (
      'missing_cogs',
      'unallocated_order_line',
      'unmatched_payout_fee',
      'missing_payout',
      'amount_mismatch',
      'unpaid_program_accrual',
      'qbo_posting_gap',
      'duplicate_candidate',
      'other'
    )),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'ignored')),
  sales_order_id UUID REFERENCES public.sales_order(id) ON DELETE SET NULL,
  sales_order_line_id UUID REFERENCES public.sales_order_line(id) ON DELETE SET NULL,
  payout_id UUID REFERENCES public.payouts(id) ON DELETE SET NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  suspected_root_cause TEXT,
  recommended_action TEXT,
  amount_expected NUMERIC(12,2),
  amount_actual NUMERIC(12,2),
  variance_amount NUMERIC(12,2),
  owner_id UUID,
  due_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  close_code TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expected_settlement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actual_settlement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_case ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expected_settlement_line_staff_all" ON public.expected_settlement_line
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "actual_settlement_line_staff_all" ON public.actual_settlement_line
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "reconciliation_case_staff_all" ON public.reconciliation_case
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_reconciliation_case_updated_at
  BEFORE UPDATE ON public.reconciliation_case
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_expected_settlement_order
  ON public.expected_settlement_line(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_actual_settlement_order
  ON public.actual_settlement_line(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_case_open
  ON public.reconciliation_case(status, severity, created_at)
  WHERE status IN ('open', 'in_progress');

INSERT INTO public.expected_settlement_line (sales_order_id, category, amount, currency, source, confidence, idempotency_key, metadata, created_at)
SELECT so.id, 'gross', COALESCE(so.gross_total, 0), COALESCE(so.currency, 'GBP'), 'sales_order', 'actual',
       'expected:gross:' || so.id::text, '{}'::jsonb, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.gross_total, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.expected_settlement_line (sales_order_id, category, amount, currency, source, confidence, idempotency_key, metadata, created_at)
SELECT so.id, 'discount', -ABS(COALESCE(so.discount_total, so.club_discount_amount, 0)), COALESCE(so.currency, 'GBP'), 'sales_order', 'actual',
       'expected:discount:' || so.id::text, '{}'::jsonb, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.discount_total, so.club_discount_amount, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.expected_settlement_line (sales_order_id, category, amount, currency, source, confidence, idempotency_key, metadata, created_at)
SELECT so.id, 'shipping', COALESCE(so.shipping_total, 0), COALESCE(so.currency, 'GBP'), 'sales_order', 'actual',
       'expected:shipping:' || so.id::text, '{}'::jsonb, so.created_at
FROM public.sales_order so
WHERE COALESCE(so.shipping_total, 0) <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.expected_settlement_line (sales_order_id, category, amount, currency, source, confidence, idempotency_key, metadata, created_at)
SELECT pf.sales_order_id, 'fee', -ABS(SUM(pf.amount)), 'GBP', 'payout_fee', 'actual',
       'expected:fee:' || pf.sales_order_id::text, jsonb_build_object('source', 'payout_fee'), MIN(pf.created_at)
FROM public.payout_fee pf
WHERE pf.sales_order_id IS NOT NULL
GROUP BY pf.sales_order_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.expected_settlement_line (sales_order_id, sales_program_accrual_id, category, amount, currency, source, confidence, idempotency_key, metadata, created_at)
SELECT spa.sales_order_id, spa.id, 'commission', -ABS(spa.commission_amount - spa.reversed_amount),
       spa.currency, 'sales_program_accrual', 'actual',
       'expected:program_commission:' || spa.id::text,
       jsonb_build_object('sales_program_id', spa.sales_program_id),
       spa.created_at
FROM public.sales_program_accrual spa
WHERE spa.accrual_type = 'commission'
  AND spa.commission_amount - spa.reversed_amount <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.actual_settlement_line (
  payout_id,
  sales_order_id,
  source_system,
  category,
  amount,
  currency,
  external_reference,
  idempotency_key,
  metadata,
  occurred_at
)
SELECT
  po.payout_id,
  po.sales_order_id,
  p.channel::text,
  'net',
  COALESCE(po.order_net, po.order_gross - po.order_fees, 0),
  'GBP',
  p.external_payout_id,
  'actual:payout_order:' || po.id::text,
  jsonb_build_object('order_gross', po.order_gross, 'order_fees', po.order_fees),
  p.payout_date::timestamptz
FROM public.payout_orders po
JOIN public.payouts p ON p.id = po.payout_id
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.actual_settlement_line (
  payout_id,
  sales_order_id,
  payout_fee_id,
  source_system,
  category,
  amount,
  currency,
  external_reference,
  idempotency_key,
  metadata,
  occurred_at
)
SELECT
  pf.payout_id,
  pf.sales_order_id,
  pf.id,
  pf.channel,
  'fee',
  -ABS(pf.amount),
  'GBP',
  pf.external_order_id,
  'actual:payout_fee:' || pf.id::text,
  jsonb_build_object('fee_category', pf.fee_category),
  pf.created_at
FROM public.payout_fee pf
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.reconciliation_case (
  case_type,
  severity,
  sales_order_id,
  sales_order_line_id,
  related_entity_type,
  related_entity_id,
  suspected_root_cause,
  recommended_action,
  evidence
)
SELECT
  'missing_cogs',
  'high',
  sol.sales_order_id,
  sol.id,
  'sales_order_line',
  sol.id,
  'Sale line has no COGS amount after backfill.',
  'Allocate a stock unit or record an approved manual costing exception.',
  jsonb_build_object('sku_id', sol.sku_id, 'stock_unit_id', sol.stock_unit_id)
FROM public.sales_order_line sol
WHERE sol.economics_status = 'needs_allocation'
  AND NOT EXISTS (
    SELECT 1 FROM public.reconciliation_case rc
    WHERE rc.case_type = 'missing_cogs'
      AND rc.sales_order_line_id = sol.id
      AND rc.status IN ('open', 'in_progress')
  );

INSERT INTO public.reconciliation_case (
  case_type,
  severity,
  related_entity_type,
  related_entity_id,
  suspected_root_cause,
  recommended_action,
  amount_expected,
  evidence
)
SELECT
  'unmatched_payout_fee',
  'medium',
  'payout_fee',
  pf.id,
  'Payout fee has no matched local sales order.',
  'Late-match by external order ID or create a platform-level fee allocation.',
  pf.amount,
  jsonb_build_object('external_order_id', pf.external_order_id, 'channel', pf.channel, 'fee_category', pf.fee_category)
FROM public.payout_fee pf
WHERE pf.sales_order_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.reconciliation_case rc
    WHERE rc.case_type = 'unmatched_payout_fee'
      AND rc.related_entity_type = 'payout_fee'
      AND rc.related_entity_id = pf.id
      AND rc.status IN ('open', 'in_progress')
  );

INSERT INTO public.reconciliation_case (
  case_type,
  severity,
  sales_order_id,
  related_entity_type,
  related_entity_id,
  suspected_root_cause,
  recommended_action,
  amount_expected,
  evidence
)
SELECT
  'unpaid_program_accrual',
  'medium',
  spa.sales_order_id,
  'sales_program_accrual',
  spa.id,
  'Program commission accrual is open and not attached to a settlement.',
  'Include this accrual in the next Blue Bell settlement run.',
  spa.commission_amount - spa.reversed_amount,
  jsonb_build_object('sales_program_id', spa.sales_program_id, 'status', spa.status)
FROM public.sales_program_accrual spa
WHERE spa.status IN ('open', 'partially_settled')
  AND spa.settlement_id IS NULL
  AND spa.commission_amount - spa.reversed_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.reconciliation_case rc
    WHERE rc.case_type = 'unpaid_program_accrual'
      AND rc.related_entity_type = 'sales_program_accrual'
      AND rc.related_entity_id = spa.id
      AND rc.status IN ('open', 'in_progress')
  );

-- ─────────────────────────────────────────────────────────────
-- 7. Market Signal Normalization
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_signal_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'market_data'
    CHECK (source_type IN ('internal', 'market_data', 'valuation', 'demand', 'manual')),
  active BOOLEAN NOT NULL DEFAULT true,
  rate_limit_per_day INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_signal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.market_signal_source(id),
  sku_id UUID REFERENCES public.sku(id) ON DELETE SET NULL,
  mpn TEXT,
  condition_grade public.condition_grade,
  channel TEXT,
  signal_type TEXT NOT NULL
    CHECK (signal_type IN ('sold_price', 'asking_price', 'availability', 'valuation', 'wishlist_demand', 'realized_margin', 'manual')),
  observed_price NUMERIC(12,2),
  observed_price_min NUMERIC(12,2),
  observed_price_max NUMERIC(12,2),
  sample_size INTEGER,
  vat_treatment TEXT NOT NULL DEFAULT 'unknown'
    CHECK (vat_treatment IN ('inclusive', 'exclusive', 'not_applicable', 'unknown')),
  source_confidence NUMERIC(8,6) NOT NULL DEFAULT 0.5,
  freshness_score NUMERIC(8,6),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_landing_table TEXT,
  raw_landing_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_price_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.market_signal_source(id),
  sku_id UUID REFERENCES public.sku(id) ON DELETE SET NULL,
  mpn TEXT,
  condition_grade public.condition_grade,
  channel TEXT,
  price NUMERIC(12,2) NOT NULL,
  price_low NUMERIC(12,2),
  price_high NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'GBP',
  vat_treatment TEXT NOT NULL DEFAULT 'unknown',
  sample_size INTEGER,
  confidence_score NUMERIC(8,6) NOT NULL DEFAULT 0.5,
  freshness_score NUMERIC(8,6),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_landing_table TEXT,
  raw_landing_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.market_signal_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_price_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_signal_source_staff_all" ON public.market_signal_source
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "market_signal_staff_all" ON public.market_signal
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE POLICY "market_price_snapshot_staff_all" ON public.market_price_snapshot
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE TRIGGER set_market_signal_source_updated_at
  BEFORE UPDATE ON public.market_signal_source
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.market_signal_source (source_code, name, source_type, rate_limit_per_day, metadata)
VALUES
  ('internal_realized_sale', 'Internal Realized Sales', 'internal', NULL, '{}'::jsonb),
  ('ebay_sold', 'eBay Sold Prices', 'market_data', NULL, '{}'::jsonb),
  ('bricklink_price_guide', 'BrickLink Price Guide', 'market_data', NULL, '{}'::jsonb),
  ('brickowl_availability', 'BrickOwl Availability', 'market_data', NULL, '{}'::jsonb),
  ('brickeconomy', 'BrickEconomy Valuation', 'valuation', 100, jsonb_build_object('respect_daily_limit', true)),
  ('manual_override', 'Manual Market Override', 'manual', NULL, '{}'::jsonb),
  ('legacy_sku_market_price', 'Legacy SKU Market Price', 'manual', NULL, '{}'::jsonb)
ON CONFLICT (source_code) DO NOTHING;

INSERT INTO public.market_price_snapshot (
  source_id,
  sku_id,
  mpn,
  condition_grade,
  channel,
  price,
  currency,
  vat_treatment,
  confidence_score,
  freshness_score,
  captured_at,
  metadata
)
SELECT
  mss.id,
  sk.id,
  COALESCE(sk.mpn, p.mpn),
  sk.condition_grade,
  'legacy',
  sk.market_price,
  'GBP',
  'unknown',
  0.40,
  0.25,
  COALESCE(sk.updated_at, sk.created_at),
  jsonb_build_object('backfill', true)
FROM public.sku sk
LEFT JOIN public.product p ON p.id = sk.product_id
JOIN public.market_signal_source mss ON mss.source_code = 'legacy_sku_market_price'
WHERE sk.market_price IS NOT NULL
  AND sk.market_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.market_price_snapshot mps
    WHERE mps.source_id = mss.id
      AND mps.sku_id = sk.id
      AND mps.price = sk.market_price
  );

INSERT INTO public.market_signal (
  source_id,
  mpn,
  signal_type,
  observed_price,
  vat_treatment,
  source_confidence,
  freshness_score,
  observed_at,
  raw_landing_table,
  raw_landing_id,
  metadata
)
SELECT
  mss.id,
  lrb.external_id,
  'valuation',
  NULL,
  'unknown',
  0.50,
  0.50,
  lrb.received_at,
  'landing_raw_brickeconomy',
  lrb.id,
  jsonb_build_object('entity_type', lrb.entity_type, 'backfill', true)
FROM public.landing_raw_brickeconomy lrb
JOIN public.market_signal_source mss ON mss.source_code = 'brickeconomy'
WHERE NOT EXISTS (
  SELECT 1 FROM public.market_signal ms
  WHERE ms.raw_landing_table = 'landing_raw_brickeconomy'
    AND ms.raw_landing_id = lrb.id
);

CREATE INDEX IF NOT EXISTS idx_market_signal_sku_observed
  ON public.market_signal(sku_id, observed_at DESC)
  WHERE sku_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_signal_mpn_observed
  ON public.market_signal(mpn, observed_at DESC)
  WHERE mpn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_price_snapshot_sku
  ON public.market_price_snapshot(sku_id, captured_at DESC)
  WHERE sku_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 8. Outbound command support for listing orchestration
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outbound_command (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_system TEXT NOT NULL,
  command_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'acknowledged', 'failed', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_system, command_type, idempotency_key)
);

ALTER TABLE public.outbound_command ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbound_command_staff_all" ON public.outbound_command
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());
CREATE TRIGGER set_outbound_command_updated_at
  BEFORE UPDATE ON public.outbound_command
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_outbound_command_pending
  ON public.outbound_command(target_system, status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- ─────────────────────────────────────────────────────────────
-- 9. Domain RPCs for first cutover
-- ─────────────────────────────────────────────────────────────

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
AS $$
DECLARE
  v_policy public.price_policy%ROWTYPE;
  v_channel_policy public.channel_price_policy%ROWTYPE;
  v_program public.sales_program%ROWTYPE;
  v_current_price NUMERIC;
  v_market_price NUMERIC;
  v_carrying_value NUMERIC := 0;
  v_candidate NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_commission NUMERIC := 0;
  v_fee_rate NUMERIC := 0;
  v_fees NUMERIC := 0;
  v_cost_base NUMERIC := 0;
  v_floor NUMERIC := 0;
  v_target NUMERIC := 0;
  v_expected_margin NUMERIC := 0;
  v_expected_margin_rate NUMERIC;
  v_blocking JSONB := '[]'::jsonb;
  v_override_required BOOLEAN := false;
BEGIN
  SELECT * INTO v_policy
  FROM public.price_policy
  WHERE policy_code = 'default'
  LIMIT 1;

  SELECT * INTO v_channel_policy
  FROM public.channel_price_policy
  WHERE price_policy_id = v_policy.id
    AND channel = p_channel
    AND active = true
  LIMIT 1;

  SELECT COALESCE(sk.price, sk.sale_price, 0), COALESCE(sk.market_price, sk.price, sk.sale_price, 0)
  INTO v_current_price, v_market_price
  FROM public.sku sk
  WHERE sk.id = p_sku_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % not found', p_sku_id;
  END IF;

  SELECT ROUND(MAX(COALESCE(su.carrying_value, su.landed_cost, 0)), 2)
  INTO v_carrying_value
  FROM public.stock_unit su
  WHERE su.sku_id = p_sku_id
    AND COALESCE(su.v2_status::text, su.status::text) IN ('graded', 'listed', 'available', 'reserved', 'restocked');

  v_carrying_value := COALESCE(v_carrying_value, 0);
  v_candidate := COALESCE(p_candidate_price, v_current_price, v_market_price, 0);

  IF p_sales_program_code IS NOT NULL THEN
    SELECT * INTO v_program
    FROM public.sales_program
    WHERE program_code = p_sales_program_code
      AND status = 'active';
    IF FOUND THEN
      v_discount := ROUND(v_candidate * COALESCE(v_program.default_discount_rate, 0), 2);
      v_commission := ROUND(GREATEST(v_candidate - v_discount, 0) * COALESCE(v_program.default_commission_rate, 0), 2);
    END IF;
  END IF;

  v_fee_rate := COALESCE(v_channel_policy.marketplace_fee_rate, 0)
              + COALESCE(v_channel_policy.payment_fee_rate, 0)
              + COALESCE(v_channel_policy.advertising_fee_rate, 0)
              + COALESCE(v_policy.risk_reserve_rate, 0);
  v_fees := ROUND(GREATEST(v_candidate - v_discount, 0) * v_fee_rate + COALESCE(v_channel_policy.fixed_fee_amount, 0), 2);
  v_cost_base := v_carrying_value
               + COALESCE(v_channel_policy.default_packaging_cost, 0)
               + COALESCE(v_channel_policy.default_delivery_cost, 0)
               + v_fees
               + v_commission;

  v_floor := CASE
    WHEN (1 - COALESCE(v_channel_policy.minimum_margin_rate, v_policy.minimum_margin_rate, 0.25)) <= 0 THEN v_cost_base
    ELSE ROUND((v_cost_base + COALESCE(v_channel_policy.minimum_profit_amount, v_policy.minimum_profit_amount, 0)) /
      (1 - COALESCE(v_channel_policy.minimum_margin_rate, v_policy.minimum_margin_rate, 0.25)), 2)
  END;

  v_target := GREATEST(v_floor, COALESCE(v_market_price, v_candidate, 0));
  v_expected_margin := ROUND(GREATEST(v_candidate - v_discount, 0) - v_fees - v_commission - v_carrying_value, 2);
  v_expected_margin_rate := CASE WHEN v_candidate > 0 THEN ROUND(v_expected_margin / v_candidate, 6) ELSE NULL END;

  IF v_candidate < v_floor THEN
    v_blocking := v_blocking || jsonb_build_array('below_channel_net_floor');
    v_override_required := true;
  END IF;

  RETURN jsonb_build_object(
    'sku_id', p_sku_id,
    'channel', p_channel,
    'gross_price', v_candidate,
    'ex_vat_revenue', ROUND(v_candidate / 1.2, 2),
    'discounts', v_discount,
    'fee_components', jsonb_build_object(
      'estimated_fees', v_fees,
      'fee_rate', v_fee_rate,
      'fixed_fee_amount', COALESCE(v_channel_policy.fixed_fee_amount, 0)
    ),
    'cogs_or_carrying_value', v_carrying_value,
    'program_commission', v_commission,
    'floor_price', v_floor,
    'target_price', v_target,
    'ceiling_price', GREATEST(v_target, v_floor),
    'expected_gross_margin', ROUND(v_candidate - v_carrying_value, 2),
    'expected_net_margin', v_expected_margin,
    'expected_net_margin_rate', v_expected_margin_rate,
    'confidence', 0.50,
    'blocking_reasons', v_blocking,
    'override_required', v_override_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sales_program_accrual(
  p_sales_order_id UUID,
  p_program_code TEXT DEFAULT 'blue_bell',
  p_attribution_source TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id UUID;
  v_attribution_id UUID;
  v_order public.sales_order%ROWTYPE;
  v_basis NUMERIC;
  v_discount NUMERIC;
  v_commission NUMERIC;
  v_accrual_id UUID;
BEGIN
  SELECT id INTO v_program_id
  FROM public.sales_program
  WHERE program_code = p_program_code
    AND status = 'active';

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'Sales program % is not active or does not exist', p_program_code;
  END IF;

  SELECT * INTO v_order FROM public.sales_order WHERE id = p_sales_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order % not found', p_sales_order_id;
  END IF;

  INSERT INTO public.sales_program_attribution (
    sales_order_id,
    sales_program_id,
    attribution_source,
    actor_id,
    locked_at
  )
  VALUES (p_sales_order_id, v_program_id, p_attribution_source, p_actor_id, now())
  ON CONFLICT (sales_order_id, sales_program_id) DO UPDATE
  SET attribution_source = EXCLUDED.attribution_source,
      actor_id = EXCLUDED.actor_id
  RETURNING id INTO v_attribution_id;

  SELECT
    ROUND(GREATEST(COALESCE(v_order.merchandise_subtotal, v_order.gross_total, 0) - COALESCE(v_order.discount_total, 0), 0), 2),
    ROUND(COALESCE(NULLIF(v_order.club_discount_amount, 0), COALESCE(v_order.merchandise_subtotal, 0) * sp.default_discount_rate), 2),
    ROUND(COALESCE(NULLIF(v_order.club_commission_amount, 0), GREATEST(COALESCE(v_order.merchandise_subtotal, v_order.gross_total, 0) - COALESCE(v_order.discount_total, 0), 0) * sp.default_commission_rate), 2)
  INTO v_basis, v_discount, v_commission
  FROM public.sales_program sp
  WHERE sp.id = v_program_id;

  INSERT INTO public.sales_program_accrual (
    sales_program_id,
    sales_order_id,
    attribution_id,
    accrual_type,
    basis_amount,
    discount_amount,
    commission_amount,
    currency,
    status,
    source
  )
  VALUES (
    v_program_id,
    p_sales_order_id,
    v_attribution_id,
    'commission',
    v_basis,
    v_discount,
    v_commission,
    COALESCE(v_order.currency, 'GBP'),
    'open',
    p_attribution_source
  )
  ON CONFLICT (sales_program_id, sales_order_id, accrual_type) DO UPDATE
  SET attribution_id = EXCLUDED.attribution_id,
      basis_amount = EXCLUDED.basis_amount,
      discount_amount = EXCLUDED.discount_amount,
      commission_amount = EXCLUDED.commission_amount,
      updated_at = now()
  RETURNING id INTO v_accrual_id;

  UPDATE public.sales_order
  SET blue_bell_club = CASE WHEN p_program_code = 'blue_bell' THEN true ELSE blue_bell_club END,
      club_discount_amount = CASE WHEN p_program_code = 'blue_bell' THEN v_discount ELSE club_discount_amount END,
      club_commission_amount = CASE WHEN p_program_code = 'blue_bell' THEN v_commission ELSE club_commission_amount END
  WHERE id = p_sales_order_id;

  RETURN v_accrual_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_stock_for_order_line(
  p_sales_order_line_id UUID,
  p_requested_stock_unit_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.sales_order_line%ROWTYPE;
  v_unit public.stock_unit%ROWTYPE;
  v_method TEXT;
  v_allocation_id UUID;
  v_cost_event_id UUID;
  v_cogs NUMERIC;
BEGIN
  SELECT * INTO v_line
  FROM public.sales_order_line
  WHERE id = p_sales_order_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order_line % not found', p_sales_order_line_id;
  END IF;

  IF v_line.stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM public.stock_unit WHERE id = v_line.stock_unit_id FOR UPDATE;
    v_method := 'specific_unit';
  ELSIF p_requested_stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM public.stock_unit
    WHERE id = p_requested_stock_unit_id
      AND sku_id = v_line.sku_id
    FOR UPDATE;
    v_method := 'specific_unit';
  ELSE
    SELECT su.* INTO v_unit
    FROM public.stock_unit su
    WHERE su.sku_id = v_line.sku_id
      AND su.condition_grade::text IN ('1', '2', '3', '4')
      AND COALESCE(su.v2_status::text, su.status::text) IN ('listed', 'graded', 'available', 'restocked')
    ORDER BY COALESCE(su.listed_at, su.created_at), su.created_at, su.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    v_method := 'fifo_fallback';
  END IF;

  IF v_unit.id IS NULL THEN
    UPDATE public.sales_order_line
    SET economics_status = 'needs_allocation',
        costing_method = COALESCE(costing_method, 'manual_exception')
    WHERE id = p_sales_order_line_id;

    INSERT INTO public.reconciliation_case (
      case_type,
      severity,
      sales_order_id,
      sales_order_line_id,
      related_entity_type,
      related_entity_id,
      suspected_root_cause,
      recommended_action,
      evidence
    )
    VALUES (
      'unallocated_order_line',
      'high',
      v_line.sales_order_id,
      v_line.id,
      'sales_order_line',
      v_line.id,
      'No eligible stock unit was available for allocation.',
      'Review stock availability or record an approved manual exception.',
      jsonb_build_object('sku_id', v_line.sku_id)
    );

    RETURN jsonb_build_object(
      'sales_order_line_id', p_sales_order_line_id,
      'allocation_method', 'manual_exception',
      'status', 'needs_allocation'
    );
  END IF;

  v_cogs := COALESCE(v_unit.carrying_value, v_unit.landed_cost, 0);

  INSERT INTO public.stock_allocation (
    sales_order_id,
    sales_order_line_id,
    sku_id,
    requested_stock_unit_id,
    selected_stock_unit_id,
    allocation_method,
    allocation_source,
    idempotency_key,
    status,
    actor_id,
    allocated_at
  )
  VALUES (
    v_line.sales_order_id,
    v_line.id,
    v_line.sku_id,
    p_requested_stock_unit_id,
    v_unit.id,
    v_method,
    'domain_rpc',
    'sale_line:' || v_line.id::text,
    'allocated',
    p_actor_id,
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET selected_stock_unit_id = EXCLUDED.selected_stock_unit_id,
      allocation_method = EXCLUDED.allocation_method,
      status = 'allocated',
      updated_at = now()
  RETURNING id INTO v_allocation_id;

  UPDATE public.stock_unit
  SET v2_status = 'sold',
      sold_at = COALESCE(sold_at, now()),
      order_id = v_line.sales_order_id
  WHERE id = v_unit.id;

  UPDATE public.sales_order_line
  SET stock_unit_id = v_unit.id,
      cogs = v_cogs,
      cogs_amount = v_cogs,
      cogs_source_unit_id = v_unit.id,
      costing_method = v_method,
      economics_status = 'final'
  WHERE id = v_line.id;

  INSERT INTO public.stock_cost_event (
    stock_unit_id,
    sales_order_id,
    sales_order_line_id,
    stock_allocation_id,
    event_type,
    amount,
    currency,
    costing_method,
    carrying_value_before,
    carrying_value_after,
    source,
    idempotency_key,
    metadata,
    event_at
  )
  VALUES (
    v_unit.id,
    v_line.sales_order_id,
    v_line.id,
    v_allocation_id,
    'sale_cogs',
    v_cogs,
    'GBP',
    v_method,
    v_cogs,
    0,
    'domain_rpc',
    'sale_cogs:' || v_line.id::text,
    jsonb_build_object('requested_stock_unit_id', p_requested_stock_unit_id),
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      stock_unit_id = EXCLUDED.stock_unit_id
  RETURNING id INTO v_cost_event_id;

  RETURN jsonb_build_object(
    'sales_order_line_id', v_line.id,
    'selected_stock_unit_id', v_unit.id,
    'allocation_method', v_method,
    'cogs_amount', v_cogs,
    'cost_event_id', v_cost_event_id,
    'stock_allocation_id', v_allocation_id,
    'status', 'allocated'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_order_line_economics(p_sales_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH order_unit_counts AS (
    SELECT sales_order_id, COUNT(*)::numeric AS line_count
    FROM public.sales_order_line
    WHERE sales_order_id = p_sales_order_id
    GROUP BY sales_order_id
  ),
  order_fee_totals AS (
    SELECT sales_order_id, SUM(amount) AS total_fee_amount
    FROM public.payout_fee
    WHERE sales_order_id = p_sales_order_id
    GROUP BY sales_order_id
  ),
  program_totals AS (
    SELECT sales_order_id,
           SUM(discount_amount) AS discount_amount,
           SUM(commission_amount - reversed_amount) AS commission_amount
    FROM public.sales_program_accrual
    WHERE sales_order_id = p_sales_order_id
    GROUP BY sales_order_id
  ),
  line_inputs AS (
    SELECT
      sol.id AS sales_order_line_id,
      sol.sales_order_id,
      sol.stock_unit_id,
      sol.line_total,
      sol.unit_price,
      sol.quantity,
      sol.cogs,
      sol.cogs_amount,
      sol.costing_method,
      su.carrying_value,
      su.landed_cost,
      ouc.line_count,
      oft.sales_order_id AS fee_sales_order_id,
      oft.total_fee_amount,
      pt.discount_amount,
      pt.commission_amount
    FROM public.sales_order_line sol
    JOIN order_unit_counts ouc ON ouc.sales_order_id = sol.sales_order_id
    LEFT JOIN order_fee_totals oft ON oft.sales_order_id = sol.sales_order_id
    LEFT JOIN program_totals pt ON pt.sales_order_id = sol.sales_order_id
    LEFT JOIN public.stock_unit su ON su.id = sol.stock_unit_id
    WHERE sol.sales_order_id = p_sales_order_id
  )
  UPDATE public.sales_order_line sol
  SET cogs_amount = COALESCE(sol.cogs_amount, li.cogs, li.carrying_value, li.landed_cost),
      cogs_source_unit_id = COALESCE(sol.cogs_source_unit_id, li.stock_unit_id),
      costing_method = CASE WHEN li.stock_unit_id IS NOT NULL THEN COALESCE(sol.costing_method, 'specific_unit') ELSE COALESCE(sol.costing_method, 'manual_exception') END,
      fee_snapshot = jsonb_build_object(
        'source', CASE WHEN li.fee_sales_order_id IS NOT NULL THEN 'actual_payout_fee' ELSE 'estimated_missing_actual' END,
        'total_fee_amount', ROUND(COALESCE(li.total_fee_amount / NULLIF(li.line_count, 0), 0), 4)
      ),
      program_discount_amount = ROUND(COALESCE(li.discount_amount / NULLIF(li.line_count, 0), 0), 2),
      program_commission_amount = ROUND(COALESCE(li.commission_amount / NULLIF(li.line_count, 0), 0), 2),
      gross_margin_amount = ROUND(COALESCE(li.line_total, li.unit_price * li.quantity, 0) - COALESCE(li.cogs_amount, li.cogs, li.carrying_value, li.landed_cost, 0), 2),
      net_margin_amount = ROUND(
        COALESCE(li.line_total, li.unit_price * li.quantity, 0)
        - COALESCE(li.cogs_amount, li.cogs, li.carrying_value, li.landed_cost, 0)
        - COALESCE(li.total_fee_amount / NULLIF(li.line_count, 0), 0)
        - COALESCE(li.commission_amount / NULLIF(li.line_count, 0), 0),
        2
      ),
      net_margin_rate = CASE
        WHEN COALESCE(li.line_total, li.unit_price * li.quantity, 0) > 0 THEN ROUND((
          COALESCE(li.line_total, li.unit_price * li.quantity, 0)
          - COALESCE(li.cogs_amount, li.cogs, li.carrying_value, li.landed_cost, 0)
          - COALESCE(li.total_fee_amount / NULLIF(li.line_count, 0), 0)
          - COALESCE(li.commission_amount / NULLIF(li.line_count, 0), 0)
        ) / COALESCE(li.line_total, li.unit_price * li.quantity, 0), 6)
        ELSE NULL
      END,
      economics_status = CASE
        WHEN li.stock_unit_id IS NULL OR COALESCE(li.cogs_amount, li.cogs, li.carrying_value, li.landed_cost) IS NULL THEN 'needs_allocation'
        ELSE 'final'
      END
  FROM line_inputs li
  WHERE sol.id = li.sales_order_line_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

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
AS $$
DECLARE
  v_quote JSONB;
  v_policy_id UUID;
  v_channel_policy_id UUID;
  v_program_id UUID;
  v_snapshot_id UUID;
BEGIN
  v_quote := public.commerce_quote_price(p_sku_id, p_channel, p_candidate_price, p_sales_program_code);

  SELECT id INTO v_policy_id
  FROM public.price_policy
  WHERE policy_code = 'default';

  SELECT id INTO v_channel_policy_id
  FROM public.channel_price_policy
  WHERE price_policy_id = v_policy_id
    AND channel = p_channel
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
    carrying_value_basis,
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
    p_channel,
    'GBP',
    (v_quote->>'gross_price')::numeric,
    (v_quote->>'gross_price')::numeric,
    (v_quote->>'floor_price')::numeric,
    (v_quote->>'target_price')::numeric,
    (v_quote->>'ceiling_price')::numeric,
    (v_quote->>'cogs_or_carrying_value')::numeric,
    (v_quote->'fee_components'->>'estimated_fees')::numeric,
    (v_quote->>'discounts')::numeric,
    (v_quote->>'program_commission')::numeric,
    (v_quote->>'gross_price')::numeric,
    (v_quote->>'gross_price')::numeric - (v_quote->'fee_components'->>'estimated_fees')::numeric,
    (v_quote->>'expected_net_margin')::numeric,
    (v_quote->>'expected_net_margin_rate')::numeric,
    (v_quote->>'confidence')::numeric,
    CASE WHEN (v_quote->>'override_required')::boolean THEN 'review' ELSE 'hold' END,
    v_quote->'blocking_reasons',
    (v_quote->>'override_required')::boolean,
    v_quote,
    'commerce_quote_v1',
    p_actor_id
  )
  RETURNING id INTO v_snapshot_id;

  IF p_channel_listing_id IS NOT NULL THEN
    UPDATE public.channel_listing
    SET current_price_decision_snapshot_id = v_snapshot_id,
        fee_adjusted_price = (v_quote->>'gross_price')::numeric,
        estimated_fees = (v_quote->'fee_components'->>'estimated_fees')::numeric,
        estimated_net = (v_quote->>'gross_price')::numeric - (v_quote->'fee_components'->>'estimated_fees')::numeric
    WHERE id = p_channel_listing_id;
  END IF;

  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_listing_command(
  p_channel_listing_id UUID,
  p_command_type TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_allow_below_floor BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.channel_listing%ROWTYPE;
  v_snapshot public.price_decision_snapshot%ROWTYPE;
  v_command_id UUID;
  v_target TEXT;
BEGIN
  SELECT * INTO v_listing
  FROM public.channel_listing
  WHERE id = p_channel_listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_listing % not found', p_channel_listing_id;
  END IF;

  IF p_command_type NOT IN ('publish', 'reprice', 'pause', 'end', 'update_price') THEN
    RAISE EXCEPTION 'Unsupported listing command type %', p_command_type;
  END IF;

  IF v_listing.current_price_decision_snapshot_id IS NULL AND v_listing.sku_id IS NOT NULL THEN
    PERFORM public.create_price_decision_snapshot(
      v_listing.sku_id,
      COALESCE(v_listing.channel, v_listing.v2_channel::text, 'website'),
      v_listing.id,
      v_listing.listed_price,
      NULL,
      p_actor_id
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.price_decision_snapshot
  WHERE id = (
    SELECT current_price_decision_snapshot_id
    FROM public.channel_listing
    WHERE id = p_channel_listing_id
  );

  IF p_command_type IN ('publish', 'reprice', 'update_price')
     AND COALESCE(v_snapshot.override_required, false)
     AND NOT p_allow_below_floor THEN
    RAISE EXCEPTION 'Listing command blocked: price decision requires override (%).', v_snapshot.blocking_reasons;
  END IF;

  v_target := COALESCE(v_listing.channel, v_listing.v2_channel::text, 'website');

  INSERT INTO public.outbound_command (
    target_system,
    command_type,
    entity_type,
    entity_id,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    v_target,
    p_command_type,
    'channel_listing',
    p_channel_listing_id,
    p_command_type || ':channel_listing:' || p_channel_listing_id::text || ':' || COALESCE(v_snapshot.id::text, 'no_snapshot'),
    'pending',
    jsonb_build_object(
      'channel_listing_id', p_channel_listing_id,
      'price_decision_snapshot_id', v_snapshot.id,
      'actor_id', p_actor_id,
      'listed_price', v_listing.listed_price
    )
  )
  ON CONFLICT (target_system, command_type, idempotency_key) DO UPDATE
  SET status = CASE WHEN public.outbound_command.status = 'failed' THEN 'pending' ELSE public.outbound_command.status END,
      updated_at = now()
  RETURNING id INTO v_command_id;

  RETURN v_command_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sales_program_settlement(
  p_program_code TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_actor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id UUID;
  v_settlement_id UUID;
BEGIN
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Settlement period end must be on or after start';
  END IF;

  SELECT id INTO v_program_id
  FROM public.sales_program
  WHERE program_code = p_program_code;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'sales_program % not found', p_program_code;
  END IF;

  INSERT INTO public.sales_program_settlement (
    sales_program_id,
    period_start,
    period_end,
    status,
    gross_sales_amount,
    discount_amount,
    commission_amount,
    reversed_amount,
    notes,
    created_by
  )
  SELECT
    v_program_id,
    p_period_start,
    p_period_end,
    'draft',
    COALESCE(SUM(so.gross_total), 0),
    COALESCE(SUM(spa.discount_amount), 0),
    COALESCE(SUM(spa.commission_amount), 0),
    COALESCE(SUM(spa.reversed_amount), 0),
    p_notes,
    p_actor_id
  FROM public.sales_program_accrual spa
  JOIN public.sales_order so ON so.id = spa.sales_order_id
  WHERE spa.sales_program_id = v_program_id
    AND spa.status IN ('open', 'partially_settled')
    AND so.created_at::date BETWEEN p_period_start AND p_period_end
  RETURNING id INTO v_settlement_id;

  UPDATE public.sales_program_accrual spa
  SET settlement_id = v_settlement_id,
      status = CASE WHEN spa.status = 'open' THEN 'partially_settled' ELSE spa.status END,
      updated_at = now()
  FROM public.sales_order so
  WHERE so.id = spa.sales_order_id
    AND spa.sales_program_id = v_program_id
    AND spa.status IN ('open', 'partially_settled')
    AND so.created_at::date BETWEEN p_period_start AND p_period_end;

  RETURN v_settlement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_qbo_posting_intents_for_order(p_sales_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.sales_order%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order % not found', p_sales_order_id;
  END IF;

  IF v_order.qbo_sales_receipt_id IS NOT NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.posting_intent (
    target_system,
    action,
    entity_type,
    entity_id,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    'qbo',
    'create_sales_receipt',
    'sales_order',
    p_sales_order_id,
    'qbo:create_sales_receipt:' || p_sales_order_id::text,
    'pending',
    jsonb_build_object(
      'sales_order_id', p_sales_order_id,
      'order_number', v_order.order_number,
      'gross_total', v_order.gross_total,
      'currency', v_order.currency
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_reconciliation_cases(p_sales_order_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    sales_order_line_id,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    evidence
  )
  SELECT
    'missing_cogs',
    'high',
    sol.sales_order_id,
    sol.id,
    'sales_order_line',
    sol.id,
    'Sale line has no finalized COGS.',
    'Allocate stock or approve a manual costing exception.',
    jsonb_build_object('sku_id', sol.sku_id, 'economics_status', sol.economics_status)
  FROM public.sales_order_line sol
  WHERE (p_sales_order_id IS NULL OR sol.sales_order_id = p_sales_order_id)
    AND (sol.cogs_amount IS NULL OR sol.economics_status = 'needs_allocation')
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_case rc
      WHERE rc.case_type = 'missing_cogs'
        AND rc.sales_order_line_id = sol.id
        AND rc.status IN ('open', 'in_progress')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    suspected_root_cause,
    recommended_action,
    amount_expected,
    amount_actual,
    variance_amount,
    evidence
  )
  WITH expected AS (
    SELECT sales_order_id, ROUND(SUM(amount), 2) AS expected_amount
    FROM public.expected_settlement_line
    WHERE sales_order_id IS NOT NULL
      AND (p_sales_order_id IS NULL OR sales_order_id = p_sales_order_id)
    GROUP BY sales_order_id
  ),
  actual AS (
    SELECT sales_order_id, ROUND(SUM(amount), 2) AS actual_amount
    FROM public.actual_settlement_line
    WHERE sales_order_id IS NOT NULL
      AND (p_sales_order_id IS NULL OR sales_order_id = p_sales_order_id)
    GROUP BY sales_order_id
  )
  SELECT
    'amount_mismatch',
    'medium',
    e.sales_order_id,
    'Expected and actual settlement amounts differ outside tolerance.',
    'Review payout, fee, refund, and QBO posting evidence.',
    e.expected_amount,
    COALESCE(a.actual_amount, 0),
    e.expected_amount - COALESCE(a.actual_amount, 0),
    jsonb_build_object('expected', e.expected_amount, 'actual', COALESCE(a.actual_amount, 0))
  FROM expected e
  LEFT JOIN actual a ON a.sales_order_id = e.sales_order_id
  WHERE ABS(e.expected_amount - COALESCE(a.actual_amount, 0)) > 0.05
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_case rc
      WHERE rc.case_type = 'amount_mismatch'
        AND rc.sales_order_id = e.sales_order_id
        AND rc.status IN ('open', 'in_progress')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 10. Compatibility Views
-- ─────────────────────────────────────────────────────────────

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
  COALESCE(lls.current_price, sk.price, sk.sale_price) AS current_price,
  COALESCE(lls.floor_price, sk.floor_price) AS floor_price,
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

CREATE OR REPLACE VIEW public.v_order_line_economics AS
SELECT
  sol.id AS sales_order_line_id,
  sol.sales_order_id,
  sol.sku_id,
  sol.stock_unit_id,
  sol.quantity,
  sol.unit_price,
  sol.line_discount,
  sol.line_total,
  sol.costing_method,
  sol.cogs_amount,
  sol.cogs_source_unit_id,
  sol.fee_snapshot,
  COALESCE((sol.fee_snapshot->>'total_fee_amount')::numeric, 0) AS total_fee_amount,
  sol.program_discount_amount,
  sol.program_commission_amount,
  sol.gross_margin_amount,
  sol.net_margin_amount,
  sol.net_margin_rate,
  sol.economics_status,
  so.origin_channel,
  so.order_number,
  so.created_at AS order_created_at
FROM public.sales_order_line sol
JOIN public.sales_order so ON so.id = sol.sales_order_id;

CREATE OR REPLACE VIEW public.v_blue_bell_statement AS
SELECT
  date_trunc('month', so.created_at)::date AS period_start,
  (date_trunc('month', so.created_at) + interval '1 month - 1 day')::date AS period_end,
  COUNT(DISTINCT so.id) AS qualifying_order_count,
  ROUND(SUM(COALESCE(spa.basis_amount, 0)), 2) AS basis_amount,
  ROUND(SUM(COALESCE(spa.discount_amount, 0)), 2) AS discount_amount,
  ROUND(SUM(COALESCE(spa.commission_amount, 0)), 2) AS commission_accrued,
  ROUND(SUM(COALESCE(spa.reversed_amount, 0)), 2) AS commission_reversed,
  ROUND(SUM(CASE WHEN spa.status = 'settled' THEN COALESCE(spa.commission_amount, 0) - COALESCE(spa.reversed_amount, 0) ELSE 0 END), 2) AS commission_settled,
  ROUND(SUM(CASE WHEN spa.status IN ('open', 'partially_settled') THEN COALESCE(spa.commission_amount, 0) - COALESCE(spa.reversed_amount, 0) ELSE 0 END), 2) AS commission_outstanding
FROM public.sales_program_accrual spa
JOIN public.sales_program sp ON sp.id = spa.sales_program_id
JOIN public.sales_order so ON so.id = spa.sales_order_id
WHERE sp.program_code = 'blue_bell'
GROUP BY date_trunc('month', so.created_at);

CREATE OR REPLACE VIEW public.v_unit_profit_v2 AS
SELECT
  su.id AS stock_unit_id,
  su.uid,
  COALESCE(sk.sku_code, su.mpn || '.' || su.condition_grade::text) AS sku,
  su.v2_status,
  su.batch_id,
  su.payout_id,
  ole.sales_order_id,
  ole.sales_order_line_id,
  ole.line_total AS gross_revenue,
  COALESCE(ole.cogs_amount, su.carrying_value, su.landed_cost, 0) AS landed_cost,
  ole.total_fee_amount,
  ole.program_commission_amount,
  ole.net_margin_amount AS net_profit,
  ROUND(ole.net_margin_rate * 100, 2) AS net_margin_pct,
  CASE WHEN ole.line_total > 0 THEN ROUND((ole.line_total - COALESCE(ole.cogs_amount, su.carrying_value, su.landed_cost, 0)) / ole.line_total * 100, 2) ELSE NULL END AS gross_margin_pct,
  CASE WHEN ole.line_total > 0 THEN ROUND(ole.total_fee_amount / ole.line_total * 100, 2) ELSE NULL END AS fee_pct
FROM public.v_order_line_economics ole
JOIN public.stock_unit su ON su.id = ole.stock_unit_id
LEFT JOIN public.sku sk ON sk.id = su.sku_id;

CREATE OR REPLACE VIEW public.v_reconciliation_inbox AS
SELECT
  rc.id,
  rc.case_type,
  rc.severity,
  rc.status,
  rc.sales_order_id,
  so.order_number,
  rc.sales_order_line_id,
  rc.payout_id,
  rc.related_entity_type,
  rc.related_entity_id,
  rc.suspected_root_cause,
  rc.recommended_action,
  rc.amount_expected,
  rc.amount_actual,
  rc.variance_amount,
  rc.owner_id,
  rc.due_at,
  rc.created_at,
  rc.updated_at
FROM public.reconciliation_case rc
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
WHERE rc.status IN ('open', 'in_progress')
ORDER BY
  CASE rc.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  rc.created_at ASC;

GRANT SELECT ON public.v_current_sku_pricing TO authenticated;
GRANT SELECT ON public.v_order_line_economics TO authenticated;
GRANT SELECT ON public.v_blue_bell_statement TO authenticated;
GRANT SELECT ON public.v_unit_profit_v2 TO authenticated;
GRANT SELECT ON public.v_reconciliation_inbox TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 11. Safe constraints, idempotency indexes, deprecation comments
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sales_program_attribution_unique
  ON public.sales_program_attribution(sales_order_id, sales_program_id);
CREATE INDEX IF NOT EXISTS idx_price_decision_snapshot_current_lookup
  ON public.price_decision_snapshot(channel_listing_id, created_at DESC)
  WHERE channel_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_event_idempotency
  ON public.accounting_event(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_posting_intent_idempotency
  ON public.posting_intent(target_system, action, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_expected_settlement_idempotency
  ON public.expected_settlement_line(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_actual_settlement_idempotency
  ON public.actual_settlement_line(idempotency_key);

ALTER TABLE public.sales_order_line
  ADD CONSTRAINT sales_order_line_costing_method_chk
  CHECK (costing_method IS NULL OR costing_method IN ('specific_unit', 'fifo_fallback', 'manual_exception', 'legacy_backfill')) NOT VALID;

ALTER TABLE public.sales_order_line
  ADD CONSTRAINT sales_order_line_economics_status_chk
  CHECK (economics_status IN ('draft', 'quoted', 'needs_allocation', 'estimated', 'final', 'exception')) NOT VALID;

ALTER TABLE public.sales_order_line
  ADD CONSTRAINT sales_order_line_final_requires_cogs_chk
  CHECK (economics_status <> 'final' OR cogs_amount IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS sales_program_accrual_settled_once_idx
  ON public.sales_program_accrual(id)
  WHERE status = 'settled';

COMMENT ON COLUMN public.sales_order.blue_bell_club IS
  'Deprecated compatibility field. New writes should use sales_program_attribution and sales_program_accrual.';
COMMENT ON COLUMN public.sales_order.club_commission_amount IS
  'Deprecated compatibility field. New writes should use sales_program_accrual.';
COMMENT ON COLUMN public.sales_order_line.cogs IS
  'Deprecated compatibility field. New writes should use sales_order_line.cogs_amount plus stock_cost_event.';
COMMENT ON COLUMN public.sku.floor_price IS
  'Deprecated compatibility field. Future authoritative floors live in price_decision_snapshot.';
COMMENT ON COLUMN public.sku.avg_cost IS
  'Compatibility read model. Authoritative costing lives on stock_unit and stock_cost_event.';
COMMENT ON COLUMN public.sku.cost_range IS
  'Compatibility read model. Authoritative costing lives on stock_unit and stock_cost_event.';
COMMENT ON COLUMN public.channel_listing.estimated_fees IS
  'Deprecated compatibility field. Future fee estimates live in price_decision_snapshot and order-line economics.';
COMMENT ON COLUMN public.channel_listing.estimated_net IS
  'Deprecated compatibility field. Future net estimates live in price_decision_snapshot and settlement lines.';

COMMENT ON TABLE public.price_decision_snapshot IS
  'Immutable pricing decision snapshot used by listing publication, repricing, order economics, and audit.';
COMMENT ON TABLE public.stock_cost_event IS
  'Operational costing subledger for receipt, sale COGS, impairment, returns, write-offs, scrap, and part-out events.';
COMMENT ON TABLE public.accounting_event IS
  'App-side accounting event ledger. QBO remains the financial book of record; posting_intent controls outbound writes.';
COMMENT ON TABLE public.reconciliation_case IS
  'Operational exception queue for settlement, COGS, payout, sales-program, and QBO posting mismatches.';

COMMIT;
