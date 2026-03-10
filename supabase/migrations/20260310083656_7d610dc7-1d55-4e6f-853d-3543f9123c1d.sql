
-- Create tax_code table for QBO TaxCode entities
CREATE TABLE public.tax_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_tax_code_id text UNIQUE NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sales_tax_rate_id uuid REFERENCES public.vat_rate(id),
  purchase_tax_rate_id uuid REFERENCES public.vat_rate(id),
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.tax_code ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tax codes managed by staff"
  ON public.tax_code FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Tax codes public read"
  ON public.tax_code FOR SELECT TO public
  USING (true);

-- Add tax_code_id FK to inbound_receipt_line
ALTER TABLE public.inbound_receipt_line
  ADD COLUMN tax_code_id uuid REFERENCES public.tax_code(id);

-- Add tax_code_id FK to sales_order_line
ALTER TABLE public.sales_order_line
  ADD COLUMN tax_code_id uuid REFERENCES public.tax_code(id);
