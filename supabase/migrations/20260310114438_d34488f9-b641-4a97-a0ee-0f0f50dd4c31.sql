
-- Create customer table
CREATE TABLE public.customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_customer_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text,
  phone text,
  mobile text,
  billing_line_1 text,
  billing_line_2 text,
  billing_city text,
  billing_county text,
  billing_postcode text,
  billing_country text DEFAULT 'GB',
  notes text,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers managed by staff" ON public.customer
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Customers readable by all" ON public.customer
  FOR SELECT TO public USING (true);

-- Add customer_id FK to sales_order
ALTER TABLE public.sales_order ADD COLUMN customer_id uuid REFERENCES public.customer(id);

-- updated_at trigger
CREATE TRIGGER update_customer_updated_at
  BEFORE UPDATE ON public.customer
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
