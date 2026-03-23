-- ============================================================
-- V2 Payout Pipeline Improvements
-- Adds audit columns, payout-order join table, and indexes.
-- ============================================================

-- Add missing columns to payouts
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT DEFAULT 'pending';

-- Indexes for payout lookups
CREATE INDEX IF NOT EXISTS idx_payouts_external ON public.payouts(external_payout_id);
CREATE INDEX IF NOT EXISTS idx_payouts_channel_date ON public.payouts(channel, payout_date);

-- Payout-order join table: tracks which orders are covered by which payout
CREATE TABLE IF NOT EXISTS public.payout_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES public.payouts(id),
  sales_order_id UUID NOT NULL REFERENCES public.sales_order(id),
  order_gross NUMERIC(12,2),
  order_fees NUMERIC(12,2),
  order_net NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(payout_id, sales_order_id)
);

ALTER TABLE public.payout_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payout orders managed by staff" ON public.payout_orders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- Landing table for raw eBay payout data
CREATE TABLE IF NOT EXISTS public.landing_raw_ebay_payout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  correlation_id TEXT,
  received_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.landing_raw_ebay_payout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eBay payout landing managed by staff" ON public.landing_raw_ebay_payout
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
