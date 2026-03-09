-- QBO connection tokens
CREATE TABLE public.qbo_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qbo_connection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QBO connection admin only" ON public.qbo_connection
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_qbo_connection_updated_at
  BEFORE UPDATE ON public.qbo_connection
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inbound receipt status enum
CREATE TYPE public.receipt_status AS ENUM ('pending', 'processed', 'error');

-- Inbound receipt headers
CREATE TABLE public.inbound_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_purchase_id text NOT NULL UNIQUE,
  vendor_name text,
  txn_date date,
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  raw_payload jsonb,
  status receipt_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbound_receipt ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Receipts managed by staff" ON public.inbound_receipt
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Inbound receipt lines
CREATE TABLE public.inbound_receipt_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_receipt_id uuid NOT NULL REFERENCES public.inbound_receipt(id) ON DELETE CASCADE,
  description text,
  quantity integer NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  qbo_item_id text,
  mpn text,
  is_stock_line boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbound_receipt_line ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Receipt lines managed by staff" ON public.inbound_receipt_line
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));