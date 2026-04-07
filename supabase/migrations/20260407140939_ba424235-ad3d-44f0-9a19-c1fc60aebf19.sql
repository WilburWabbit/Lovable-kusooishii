
-- Atomic UID reservation function for bulk stock unit inserts
CREATE OR REPLACE FUNCTION public.v2_reserve_stock_unit_uids(p_batch_id TEXT, p_count INTEGER)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_counter INTEGER;
  v_new_counter INTEGER;
  v_batch_num TEXT;
  v_uids TEXT[];
BEGIN
  IF p_count <= 0 THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  -- Atomically reserve the range
  UPDATE public.purchase_batches
  SET unit_counter = unit_counter + p_count
  WHERE id = p_batch_id
  RETURNING unit_counter - p_count, unit_counter
  INTO v_old_counter, v_new_counter;

  IF v_old_counter IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  -- Extract numeric part from batch id (e.g. 'PO-581' -> '581')
  v_batch_num := replace(replace(p_batch_id, 'PO-', ''), 'PO', '');
  v_batch_num := ltrim(v_batch_num, '0');
  IF v_batch_num = '' THEN v_batch_num := '0'; END IF;

  -- Build UID array
  FOR i IN 1..p_count LOOP
    v_uids := array_append(v_uids, 'PO' || v_batch_num || '-' || lpad((v_old_counter + i)::text, 2, '0'));
  END LOOP;

  RETURN v_uids;
END;
$$;
