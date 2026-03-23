CREATE SEQUENCE IF NOT EXISTS public.purchase_batch_seq START WITH 1;

ALTER TABLE public.purchase_batches
  ALTER COLUMN id SET DEFAULT 'PO-' || lpad(nextval('public.purchase_batch_seq')::text, 3, '0');

CREATE OR REPLACE FUNCTION public.v2_generate_stock_unit_uid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE batch_num TEXT; seq_num INTEGER;
BEGIN
  IF NEW.batch_id IS NOT NULL AND NEW.uid IS NULL THEN
    batch_num := replace(replace(NEW.batch_id, 'PO-', ''), 'PO', '');
    batch_num := ltrim(batch_num, '0');
    IF batch_num = '' THEN batch_num := '0'; END IF;
    UPDATE public.purchase_batches SET unit_counter = unit_counter + 1
    WHERE id = NEW.batch_id RETURNING unit_counter INTO seq_num;
    NEW.uid := 'PO' || batch_num || '-' || lpad(seq_num::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_v2_generate_uid
  BEFORE INSERT ON public.stock_unit
  FOR EACH ROW EXECUTE FUNCTION public.v2_generate_stock_unit_uid();

CREATE OR REPLACE FUNCTION public.v2_calculate_apportioned_costs(p_batch_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_total_shared NUMERIC(12,2); v_total_unit_cost NUMERIC;
BEGIN
  SELECT total_shared_costs INTO v_total_shared FROM public.purchase_batches WHERE id = p_batch_id;
  IF v_total_shared IS NULL OR v_total_shared = 0 THEN
    UPDATE public.purchase_line_items SET apportioned_cost = 0, landed_cost_per_unit = unit_cost WHERE batch_id = p_batch_id;
  ELSE
    SELECT COALESCE(SUM(unit_cost * quantity), 0) INTO v_total_unit_cost FROM public.purchase_line_items WHERE batch_id = p_batch_id;
    IF v_total_unit_cost > 0 THEN
      UPDATE public.purchase_line_items
      SET apportioned_cost = ROUND((unit_cost / v_total_unit_cost) * v_total_shared, 2),
          landed_cost_per_unit = unit_cost + ROUND((unit_cost / v_total_unit_cost) * v_total_shared, 2)
      WHERE batch_id = p_batch_id;
    END IF;
  END IF;
  UPDATE public.stock_unit su SET landed_cost = pli.landed_cost_per_unit
  FROM public.purchase_line_items pli WHERE su.line_item_id = pli.id AND su.batch_id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_reallocate_costs_by_grade(p_line_item_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_total_landed NUMERIC; v_total_expected_revenue NUMERIC; rec RECORD;
  grade_ratio NUMERIC[] := ARRAY[1.0, 0.8, 0.6, 0.4];
BEGIN
  SELECT quantity * landed_cost_per_unit INTO v_total_landed FROM public.purchase_line_items WHERE id = p_line_item_id;
  IF v_total_landed IS NULL OR v_total_landed = 0 THEN RETURN; END IF;
  SELECT COALESCE(SUM(
    CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price
    ELSE grade_ratio[su.condition_grade::integer] * 100 END
  ), 0) INTO v_total_expected_revenue
  FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
  WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL;
  IF v_total_expected_revenue = 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT su.id AS unit_id, su.condition_grade, su.mpn,
      CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price
      ELSE grade_ratio[su.condition_grade::integer] * 100 END AS expected_price
    FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
    WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL
  LOOP
    UPDATE public.stock_unit SET landed_cost = ROUND((rec.expected_price / v_total_expected_revenue) * v_total_landed, 2)
    WHERE id = rec.unit_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_recalculate_variant_stats(p_sku_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_avg NUMERIC(12,2); v_floor NUMERIC(12,2); v_min NUMERIC(12,2); v_max NUMERIC(12,2); v_range TEXT; v_min_margin NUMERIC := 0.25;
BEGIN
  SELECT ROUND(AVG(su.landed_cost), 2), MAX(su.landed_cost), MIN(su.landed_cost), MAX(su.landed_cost)
  INTO v_avg, v_max, v_min, v_floor
  FROM public.stock_unit su JOIN public.sku sk ON sk.id = su.sku_id
  WHERE sk.sku_code = p_sku_code AND su.v2_status IN ('graded', 'listed') AND su.landed_cost IS NOT NULL;
  IF v_floor IS NOT NULL THEN v_floor := ROUND(v_floor * (1 + v_min_margin), 2); END IF;
  IF v_min IS NOT NULL AND v_max IS NOT NULL THEN
    IF v_min = v_max THEN v_range := '£' || v_min::text;
    ELSE v_range := '£' || v_min::text || '–£' || v_max::text; END IF;
  END IF;
  UPDATE public.sku SET avg_cost = v_avg, floor_price = v_floor, cost_range = v_range WHERE sku_code = p_sku_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_compute_vat(gross NUMERIC)
RETURNS TABLE(net NUMERIC, vat NUMERIC) LANGUAGE sql IMMUTABLE
AS $$ SELECT ROUND(gross / 1.2, 2) AS net, gross - ROUND(gross / 1.2, 2) AS vat; $$;

CREATE OR REPLACE FUNCTION public.v2_consume_fifo_unit(p_sku_code TEXT)
RETURNS public.stock_unit LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_unit public.stock_unit;
BEGIN
  SELECT su.* INTO v_unit FROM public.stock_unit su JOIN public.sku sk ON sk.id = su.sku_id
  WHERE sk.sku_code = p_sku_code AND su.v2_status = 'listed'
  ORDER BY su.created_at ASC LIMIT 1 FOR UPDATE OF su;
  IF v_unit.id IS NULL THEN RAISE EXCEPTION 'No listed stock units available for SKU %', p_sku_code; END IF;
  UPDATE public.stock_unit SET v2_status = 'sold', sold_at = now() WHERE id = v_unit.id;
  RETURN v_unit;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_on_grade_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_sku_code TEXT;
BEGIN
  IF NEW.condition_grade IS NOT NULL AND NEW.mpn IS NOT NULL THEN
    v_sku_code := NEW.mpn || '.' || NEW.condition_grade::text;
    PERFORM public.v2_recalculate_variant_stats(v_sku_code);
    IF OLD.condition_grade IS NOT NULL AND OLD.condition_grade IS DISTINCT FROM NEW.condition_grade THEN
      PERFORM public.v2_recalculate_variant_stats(OLD.mpn || '.' || OLD.condition_grade::text);
    END IF;
    IF NEW.line_item_id IS NOT NULL AND (OLD.condition_grade IS NULL OR OLD.condition_grade IS DISTINCT FROM NEW.condition_grade) THEN
      PERFORM public.v2_reallocate_costs_by_grade(NEW.line_item_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_v2_on_grade_change
  AFTER UPDATE OF condition_grade ON public.stock_unit
  FOR EACH ROW WHEN (OLD.condition_grade IS DISTINCT FROM NEW.condition_grade)
  EXECUTE FUNCTION public.v2_on_grade_change();

CREATE OR REPLACE VIEW public.v2_variant_stock_summary AS
SELECT sk.sku_code, sk.mpn, sk.condition_grade,
  COUNT(su.id) FILTER (WHERE su.v2_status IN ('graded', 'listed')) AS qty_on_hand,
  ROUND(AVG(su.landed_cost) FILTER (WHERE su.v2_status IN ('graded', 'listed')), 2) AS avg_cost,
  ROUND(MAX(su.landed_cost) FILTER (WHERE su.v2_status IN ('graded', 'listed')) * 1.25, 2) AS floor_price,
  sk.sale_price, sk.market_price
FROM public.sku sk LEFT JOIN public.stock_unit su ON su.sku_id = sk.id
GROUP BY sk.sku_code, sk.mpn, sk.condition_grade, sk.sale_price, sk.market_price;

CREATE INDEX IF NOT EXISTS idx_stock_unit_fifo ON public.stock_unit(sku_id, created_at ASC) WHERE v2_status = 'listed';