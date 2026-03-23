-- ============================================================
-- Trigger: recalculate variant stats when v2_status changes to 'sold'
-- This ensures qty_on_hand, avg_cost, floor_price, cost_range
-- are updated when units are consumed by any pathway (Stripe,
-- eBay, admin allocation, or v2-process-order).
-- ============================================================

CREATE OR REPLACE FUNCTION public.v2_on_unit_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku_code TEXT;
BEGIN
  -- Only fire when v2_status transitions TO 'sold'
  IF NEW.v2_status = 'sold' AND (OLD.v2_status IS DISTINCT FROM 'sold') THEN
    -- Build SKU code from the unit's sku_id
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO v_sku_code
      FROM public.sku
      WHERE id = NEW.sku_id;

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
