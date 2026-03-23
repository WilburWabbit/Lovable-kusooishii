CREATE OR REPLACE FUNCTION public.v2_on_unit_sold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_sku_code TEXT;
BEGIN
  IF NEW.v2_status = 'sold' AND (OLD.v2_status IS DISTINCT FROM 'sold') THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO v_sku_code FROM public.sku WHERE id = NEW.sku_id;
      IF v_sku_code IS NOT NULL THEN
        PERFORM public.v2_recalculate_variant_stats(v_sku_code);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_v2_on_unit_sold
  AFTER UPDATE OF v2_status ON public.stock_unit
  FOR EACH ROW
  WHEN (NEW.v2_status = 'sold' AND OLD.v2_status IS DISTINCT FROM NEW.v2_status)
  EXECUTE FUNCTION public.v2_on_unit_sold();

CREATE OR REPLACE FUNCTION public.v2_on_unit_restocked()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_sku_code TEXT;
BEGIN
  IF NEW.v2_status IN ('listed', 'restocked') AND OLD.v2_status IS DISTINCT FROM NEW.v2_status THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO v_sku_code FROM public.sku WHERE id = NEW.sku_id;
      IF v_sku_code IS NOT NULL THEN
        PERFORM public.v2_recalculate_variant_stats(v_sku_code);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_v2_on_unit_restocked
  AFTER UPDATE OF v2_status ON public.stock_unit
  FOR EACH ROW
  WHEN (NEW.v2_status IN ('listed', 'restocked') AND OLD.v2_status IS DISTINCT FROM NEW.v2_status)
  EXECUTE FUNCTION public.v2_on_unit_restocked();

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_payouts_external ON public.payouts(external_payout_id);
CREATE INDEX IF NOT EXISTS idx_payouts_channel_date ON public.payouts(channel, payout_date);

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

CREATE OR REPLACE FUNCTION public.v2_on_grade_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_sku_code TEXT; v_affected_sku TEXT;
BEGIN
  IF NEW.condition_grade IS NOT NULL AND NEW.mpn IS NOT NULL THEN
    v_sku_code := NEW.mpn || '.' || NEW.condition_grade::text;
    PERFORM public.v2_recalculate_variant_stats(v_sku_code);
    IF OLD.condition_grade IS NOT NULL AND OLD.condition_grade IS DISTINCT FROM NEW.condition_grade THEN
      PERFORM public.v2_recalculate_variant_stats(OLD.mpn || '.' || OLD.condition_grade::text);
    END IF;
    IF NEW.line_item_id IS NOT NULL AND (OLD.condition_grade IS NULL OR OLD.condition_grade IS DISTINCT FROM NEW.condition_grade) THEN
      PERFORM public.v2_reallocate_costs_by_grade(NEW.line_item_id);
      FOR v_affected_sku IN
        SELECT DISTINCT su2.mpn || '.' || su2.condition_grade::text
        FROM public.stock_unit su2
        WHERE su2.line_item_id = NEW.line_item_id AND su2.condition_grade IS NOT NULL
          AND (su2.mpn || '.' || su2.condition_grade::text) != v_sku_code
      LOOP
        PERFORM public.v2_recalculate_variant_stats(v_affected_sku);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE sku ADD COLUMN IF NOT EXISTS v2_markdown_applied text;

NOTIFY pgrst, 'reload schema';