CREATE OR REPLACE FUNCTION public.v2_consume_fifo_unit(p_sku_code text)
RETURNS public.stock_unit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_unit public.stock_unit;
BEGIN
  SELECT su.* INTO v_unit
  FROM public.stock_unit su
  JOIN public.sku sk ON sk.id = su.sku_id
  WHERE sk.sku_code = p_sku_code
    AND su.v2_status IN ('listed', 'graded')
  ORDER BY
    CASE su.v2_status WHEN 'listed' THEN 0 ELSE 1 END,
    su.created_at ASC
  LIMIT 1
  FOR UPDATE OF su;

  IF v_unit.id IS NULL THEN
    RAISE EXCEPTION 'No available stock units for SKU %', p_sku_code;
  END IF;

  UPDATE public.stock_unit
  SET v2_status = 'sold', sold_at = now()
  WHERE id = v_unit.id;

  RETURN v_unit;
END;
$$;