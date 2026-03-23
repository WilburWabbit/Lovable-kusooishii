-- ============================================================
-- Trigger: recalculate variant stats when a unit is restocked
-- When v2_status changes to 'listed' from 'restocked' (or any
-- return path), update qty_on_hand, avg_cost, floor_price.
-- ============================================================

CREATE OR REPLACE FUNCTION public.v2_on_unit_restocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku_code TEXT;
BEGIN
  -- Fire when v2_status transitions TO 'listed' or 'restocked'
  IF NEW.v2_status IN ('listed', 'restocked')
     AND OLD.v2_status IS DISTINCT FROM NEW.v2_status THEN
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

CREATE TRIGGER trg_v2_on_unit_restocked
  AFTER UPDATE OF v2_status ON public.stock_unit
  FOR EACH ROW
  WHEN (NEW.v2_status IN ('listed', 'restocked')
        AND OLD.v2_status IS DISTINCT FROM NEW.v2_status)
  EXECUTE FUNCTION public.v2_on_unit_restocked();
