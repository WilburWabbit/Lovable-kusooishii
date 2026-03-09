
-- Sequence for human-readable order numbers
CREATE SEQUENCE IF NOT EXISTS public.sales_order_number_seq;

-- sales_order table
CREATE TABLE public.sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL DEFAULT 'KO-' || lpad(nextval('public.sales_order_number_seq')::text, 7, '0'),
  origin_channel text NOT NULL DEFAULT 'web',
  origin_reference text,
  user_id uuid,
  guest_email text,
  guest_name text,
  status public.order_status NOT NULL DEFAULT 'pending_payment',
  currency text NOT NULL DEFAULT 'GBP',
  merchandise_subtotal numeric NOT NULL,
  discount_total numeric NOT NULL DEFAULT 0,
  shipping_total numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  gross_total numeric NOT NULL,
  club_id uuid REFERENCES public.club(id),
  club_discount_amount numeric NOT NULL DEFAULT 0,
  club_commission_amount numeric NOT NULL DEFAULT 0,
  payment_reference text,
  shipping_name text NOT NULL DEFAULT '',
  shipping_line_1 text NOT NULL DEFAULT '',
  shipping_line_2 text,
  shipping_city text NOT NULL DEFAULT '',
  shipping_county text,
  shipping_postcode text NOT NULL DEFAULT '',
  shipping_country text NOT NULL DEFAULT 'GB',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- sales_order_line table
CREATE TABLE public.sales_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_order(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.sku(id),
  stock_unit_id uuid REFERENCES public.stock_unit(id),
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  line_discount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sales_order_user_id ON public.sales_order(user_id);
CREATE INDEX idx_sales_order_guest_email ON public.sales_order(guest_email);
CREATE INDEX idx_sales_order_status ON public.sales_order(status);
CREATE INDEX idx_sales_order_origin_channel ON public.sales_order(origin_channel);
CREATE INDEX idx_sales_order_line_order_id ON public.sales_order_line(sales_order_id);
CREATE INDEX idx_sales_order_line_sku_id ON public.sales_order_line(sku_id);

-- Reuse updated_at trigger
CREATE TRIGGER update_sales_order_updated_at
  BEFORE UPDATE ON public.sales_order
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validation trigger: must have user_id or guest_email
CREATE OR REPLACE FUNCTION public.validate_sales_order_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.guest_email IS NULL THEN
    RAISE EXCEPTION 'sales_order must have either user_id or guest_email';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sales_order_customer
  BEFORE INSERT OR UPDATE ON public.sales_order
  FOR EACH ROW EXECUTE FUNCTION public.validate_sales_order_customer();

-- RLS
ALTER TABLE public.sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_line ENABLE ROW LEVEL SECURITY;

-- Staff/admin full access on sales_order
CREATE POLICY "Staff manage all orders" ON public.sales_order
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Members read own orders
CREATE POLICY "Members read own orders" ON public.sales_order
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Staff/admin full access on sales_order_line
CREATE POLICY "Staff manage all order lines" ON public.sales_order_line
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Members read own order lines
CREATE POLICY "Members read own order lines" ON public.sales_order_line
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_order so
    WHERE so.id = sales_order_line.sales_order_id AND so.user_id = auth.uid()
  ));
