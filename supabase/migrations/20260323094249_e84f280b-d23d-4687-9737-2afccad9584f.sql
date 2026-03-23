CREATE TYPE public.v2_unit_status AS ENUM (
  'purchased', 'graded', 'listed', 'sold', 'shipped',
  'delivered', 'payout_received', 'complete',
  'return_pending', 'refunded', 'restocked', 'needs_allocation'
);

CREATE TYPE public.purchase_batch_status AS ENUM (
  'draft', 'recorded'
);

CREATE TABLE public.purchase_batches (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  supplier_vat_registered BOOLEAN NOT NULL DEFAULT false,
  shared_costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_shared_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.purchase_batch_status NOT NULL DEFAULT 'draft',
  unit_counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Purchase batches readable by staff"
  ON public.purchase_batches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Purchase batches managed by staff"
  ON public.purchase_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER set_purchase_batches_updated_at
  BEFORE UPDATE ON public.purchase_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.purchase_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL REFERENCES public.purchase_batches(id) ON DELETE CASCADE,
  mpn TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL,
  apportioned_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  landed_cost_per_unit NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Purchase line items readable by staff"
  ON public.purchase_line_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Purchase line items managed by staff"
  ON public.purchase_line_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX idx_pli_batch_id ON public.purchase_line_items(batch_id);

ALTER TABLE public.stock_unit
  ADD COLUMN IF NOT EXISTS uid TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES public.purchase_batches(id),
  ADD COLUMN IF NOT EXISTS line_item_id UUID REFERENCES public.purchase_line_items(id),
  ADD COLUMN IF NOT EXISTS condition_flags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS v2_status public.v2_unit_status,
  ADD COLUMN IF NOT EXISTS order_id UUID,
  ADD COLUMN IF NOT EXISTS payout_id UUID,
  ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_su_batch_id ON public.stock_unit(batch_id);
CREATE INDEX IF NOT EXISTS idx_su_v2_status ON public.stock_unit(v2_status);
CREATE INDEX IF NOT EXISTS idx_su_order_id ON public.stock_unit(order_id);
CREATE INDEX IF NOT EXISTS idx_su_uid ON public.stock_unit(uid);

ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS ean TEXT,
  ADD COLUMN IF NOT EXISTS set_number TEXT,
  ADD COLUMN IF NOT EXISTS dimensions_cm TEXT,
  ADD COLUMN IF NOT EXISTS weight_g INTEGER,
  ADD COLUMN IF NOT EXISTS age_mark TEXT;

ALTER TABLE public.sku
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS floor_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cost_range TEXT,
  ADD COLUMN IF NOT EXISTS condition_notes TEXT,
  ADD COLUMN IF NOT EXISTS market_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS mpn TEXT;