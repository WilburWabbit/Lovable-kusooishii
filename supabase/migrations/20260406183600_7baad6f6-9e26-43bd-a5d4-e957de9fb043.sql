
CREATE OR REPLACE FUNCTION public.allocate_stock_units(
  p_sku_id uuid,
  p_quantity int,
  p_order_id uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit_ids uuid[];
  v_count int;
BEGIN
  SELECT array_agg(id) INTO v_unit_ids
  FROM (
    SELECT id
    FROM public.stock_unit
    WHERE sku_id = p_sku_id
      AND (status IN ('available', 'received', 'graded') OR v2_status IN ('graded', 'listed', 'purchased'))
    ORDER BY created_at ASC
    LIMIT p_quantity
    FOR UPDATE SKIP LOCKED
  ) sub;

  v_count := coalesce(array_length(v_unit_ids, 1), 0);

  IF v_count > 0 THEN
    UPDATE public.stock_unit
    SET status = 'closed',
        v2_status = 'sold',
        sold_at = now(),
        order_id = COALESCE(p_order_id, order_id),
        updated_at = now()
    WHERE id = ANY(v_unit_ids);
  END IF;

  RETURN coalesce(v_unit_ids, ARRAY[]::uuid[]);
END;
$$;
