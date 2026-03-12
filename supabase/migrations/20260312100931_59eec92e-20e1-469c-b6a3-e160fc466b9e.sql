
-- 1. Channel Fee Schedule
CREATE TABLE public.channel_fee_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  fee_name text NOT NULL,
  rate_percent numeric NOT NULL DEFAULT 0,
  fixed_amount numeric NOT NULL DEFAULT 0,
  min_amount numeric,
  max_amount numeric,
  applies_to text NOT NULL DEFAULT 'sale_price',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_fee_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel fees managed by staff" ON public.channel_fee_schedule
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER set_updated_at_channel_fee_schedule
  BEFORE UPDATE ON public.channel_fee_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Shipping Rate Table
CREATE TABLE public.shipping_rate_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'default',
  carrier text NOT NULL,
  service_name text NOT NULL,
  max_weight_kg numeric NOT NULL,
  max_length_cm numeric,
  cost numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_rate_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shipping rates managed by staff" ON public.shipping_rate_table
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER set_updated_at_shipping_rate_table
  BEFORE UPDATE ON public.shipping_rate_table
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Selling Cost Defaults
CREATE TABLE public.selling_cost_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.selling_cost_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Selling cost defaults managed by staff" ON public.selling_cost_defaults
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- 4. Seed default channel fees
INSERT INTO public.channel_fee_schedule (channel, fee_name, rate_percent, fixed_amount, applies_to, notes) VALUES
  ('ebay', 'Final Value Fee', 12.8, 0.30, 'sale_plus_shipping', 'Standard eBay FVF for most categories'),
  ('ebay', 'Promoted Listing Standard', 2.0, 0, 'sale_price', 'Optional ad rate - adjust as needed'),
  ('ebay', 'International Fee', 1.35, 0, 'sale_plus_shipping', 'Additional fee for international sales'),
  ('web', 'Stripe Processing Fee', 1.5, 0.20, 'sale_price_inc_vat', 'UK domestic card rate'),
  ('bricklink', 'BrickLink Fee', 3.0, 0, 'sale_price', 'Standard BrickLink commission');

-- 5. Seed selling cost defaults
INSERT INTO public.selling_cost_defaults (key, value) VALUES
  ('packaging_cost', 0.75),
  ('risk_reserve_rate', 2.0);
