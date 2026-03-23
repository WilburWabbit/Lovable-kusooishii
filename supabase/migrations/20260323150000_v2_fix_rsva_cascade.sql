-- ============================================================
-- Fix: RSVA cost cascade recalculates stats for ALL affected SKUs
-- When v2_reallocate_costs_by_grade() changes landed_cost on units
-- across multiple grades, we must recalculate variant stats for
-- every SKU in the line item, not just the one being graded.
-- ============================================================

CREATE OR REPLACE FUNCTION public.v2_on_grade_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sku_code TEXT;
  v_affected_sku TEXT;
BEGIN
  -- Build the SKU code from mpn + grade
  IF NEW.condition_grade IS NOT NULL AND NEW.mpn IS NOT NULL THEN
    v_sku_code := NEW.mpn || '.' || NEW.condition_grade::text;

    -- Recalculate variant stats for the new SKU
    PERFORM public.v2_recalculate_variant_stats(v_sku_code);

    -- If the grade just changed (re-grading), also recalculate for the old SKU
    IF OLD.condition_grade IS NOT NULL
       AND OLD.condition_grade IS DISTINCT FROM NEW.condition_grade THEN
      PERFORM public.v2_recalculate_variant_stats(
        OLD.mpn || '.' || OLD.condition_grade::text
      );
    END IF;

    -- Reallocate costs for the line item if grade was assigned/changed
    IF NEW.line_item_id IS NOT NULL
       AND (OLD.condition_grade IS NULL OR OLD.condition_grade IS DISTINCT FROM NEW.condition_grade) THEN
      PERFORM public.v2_reallocate_costs_by_grade(NEW.line_item_id);

      -- Cascade: RSVA changed landed_cost on units across multiple grades.
      -- Recalculate variant stats for every OTHER SKU in this line item
      -- whose costs were silently updated by RSVA.
      FOR v_affected_sku IN
        SELECT DISTINCT su2.mpn || '.' || su2.condition_grade::text
        FROM public.stock_unit su2
        WHERE su2.line_item_id = NEW.line_item_id
          AND su2.condition_grade IS NOT NULL
          AND (su2.mpn || '.' || su2.condition_grade::text) != v_sku_code
      LOOP
        PERFORM public.v2_recalculate_variant_stats(v_affected_sku);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
