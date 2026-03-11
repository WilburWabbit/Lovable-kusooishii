
-- Landing status enum
CREATE TYPE public.landing_status AS ENUM ('pending', 'staged', 'committed', 'error', 'skipped');

-- ─── QBO Purchase (receipts/bills) ───
CREATE TABLE public.landing_raw_qbo_purchase (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_qbo_purchase ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_purchase" ON public.landing_raw_qbo_purchase
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── QBO Sales Receipt ───
CREATE TABLE public.landing_raw_qbo_sales_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_qbo_sales_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_sales_receipt" ON public.landing_raw_qbo_sales_receipt
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── QBO Refund Receipt ───
CREATE TABLE public.landing_raw_qbo_refund_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_qbo_refund_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_refund_receipt" ON public.landing_raw_qbo_refund_receipt
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── QBO Customer ───
CREATE TABLE public.landing_raw_qbo_customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_qbo_customer ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_customer" ON public.landing_raw_qbo_customer
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── QBO Item ───
CREATE TABLE public.landing_raw_qbo_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_qbo_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_item" ON public.landing_raw_qbo_item
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── QBO Tax Entity (codes + rates) ───
CREATE TABLE public.landing_raw_qbo_tax_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, -- 'TaxCode' or 'TaxRate'
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (entity_type, external_id)
);
ALTER TABLE public.landing_raw_qbo_tax_entity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_qbo_tax_entity" ON public.landing_raw_qbo_tax_entity
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── eBay Order ───
CREATE TABLE public.landing_raw_ebay_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL, -- eBay order ID
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_ebay_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_ebay_order" ON public.landing_raw_ebay_order
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── eBay Listing ───
CREATE TABLE public.landing_raw_ebay_listing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL, -- eBay listing/offer ID
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_ebay_listing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_ebay_listing" ON public.landing_raw_ebay_listing
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── BrickEconomy ───
CREATE TABLE public.landing_raw_brickeconomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL, -- item_number or snapshot key
  entity_type text NOT NULL DEFAULT 'collection', -- 'collection' or 'portfolio_snapshot'
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (entity_type, external_id)
);
ALTER TABLE public.landing_raw_brickeconomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_brickeconomy" ON public.landing_raw_brickeconomy
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- ─── Stripe Event ───
CREATE TABLE public.landing_raw_stripe_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL, -- Stripe event ID (evt_...)
  event_type text NOT NULL, -- e.g. 'checkout.session.completed'
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);
ALTER TABLE public.landing_raw_stripe_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage landing_raw_stripe_event" ON public.landing_raw_stripe_event
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Indexes for efficient querying of unprocessed records
CREATE INDEX idx_landing_qbo_purchase_status ON public.landing_raw_qbo_purchase (status) WHERE status = 'pending';
CREATE INDEX idx_landing_qbo_sales_receipt_status ON public.landing_raw_qbo_sales_receipt (status) WHERE status = 'pending';
CREATE INDEX idx_landing_qbo_refund_receipt_status ON public.landing_raw_qbo_refund_receipt (status) WHERE status = 'pending';
CREATE INDEX idx_landing_qbo_customer_status ON public.landing_raw_qbo_customer (status) WHERE status = 'pending';
CREATE INDEX idx_landing_qbo_item_status ON public.landing_raw_qbo_item (status) WHERE status = 'pending';
CREATE INDEX idx_landing_qbo_tax_entity_status ON public.landing_raw_qbo_tax_entity (status) WHERE status = 'pending';
CREATE INDEX idx_landing_ebay_order_status ON public.landing_raw_ebay_order (status) WHERE status = 'pending';
CREATE INDEX idx_landing_ebay_listing_status ON public.landing_raw_ebay_listing (status) WHERE status = 'pending';
CREATE INDEX idx_landing_brickeconomy_status ON public.landing_raw_brickeconomy (status) WHERE status = 'pending';
CREATE INDEX idx_landing_stripe_event_status ON public.landing_raw_stripe_event (status) WHERE status = 'pending';
