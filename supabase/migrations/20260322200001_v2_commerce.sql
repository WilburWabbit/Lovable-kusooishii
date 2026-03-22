-- ============================================================
-- Admin V2 — Migration 2: Commerce Tables
-- New enums, payouts table, and additive columns on
-- channel_listing, sales_order, sales_order_line, customer.
-- ============================================================

-- ─── New enums ───

CREATE TYPE public.v2_channel AS ENUM (
  'ebay', 'website', 'bricklink', 'brickowl', 'in_person'
);

CREATE TYPE public.v2_channel_listing_status AS ENUM (
  'draft', 'live', 'paused', 'ended'
);

CREATE TYPE public.v2_order_status AS ENUM (
  'needs_allocation', 'new', 'awaiting_shipment', 'shipped',
  'delivered', 'complete', 'return_pending'
);

CREATE TYPE public.payout_channel AS ENUM (
  'ebay', 'stripe'
);

-- ─── Payouts table ───

CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel public.payout_channel NOT NULL,
  payout_date DATE NOT NULL,
  gross_amount NUMERIC(12,2) NOT NULL,
  total_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,
  fee_breakdown JSONB DEFAULT '{}'::jsonb,
  order_count INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  qbo_deposit_id TEXT,
  qbo_expense_id TEXT,
  qbo_sync_status TEXT DEFAULT 'pending',
  external_payout_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payouts readable by staff"
  ON public.payouts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Payouts managed by staff"
  ON public.payouts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- ─── Alter channel_listing — add v2 columns ───

ALTER TABLE public.channel_listing
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS v2_status public.v2_channel_listing_status,
  ADD COLUMN IF NOT EXISTS v2_channel public.v2_channel;

-- ─── Alter sales_order — add v2 columns ───

ALTER TABLE public.sales_order
  ADD COLUMN IF NOT EXISTS v2_status public.v2_order_status,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS blue_bell_club BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS carrier TEXT;

CREATE INDEX IF NOT EXISTS idx_so_v2_status ON public.sales_order(v2_status);

-- ─── Alter sales_order_line — add cogs ───

ALTER TABLE public.sales_order_line
  ADD COLUMN IF NOT EXISTS cogs NUMERIC(12,2);

-- ─── Alter customer — add v2 columns ───

ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS channel_ids JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS blue_bell_member BOOLEAN NOT NULL DEFAULT false;

-- ─── Add FK constraints on stock_unit ───
-- order_id and payout_id were added as bare columns in migration 1;
-- now that payouts exists we can add the foreign keys.

ALTER TABLE public.stock_unit
  ADD CONSTRAINT fk_stock_unit_order
    FOREIGN KEY (order_id) REFERENCES public.sales_order(id);

ALTER TABLE public.stock_unit
  ADD CONSTRAINT fk_stock_unit_payout
    FOREIGN KEY (payout_id) REFERENCES public.payouts(id);
