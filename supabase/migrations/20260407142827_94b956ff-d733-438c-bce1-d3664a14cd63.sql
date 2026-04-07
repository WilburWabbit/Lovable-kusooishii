CREATE OR REPLACE FUNCTION public.v2_generate_stock_unit_uid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  batch_num TEXT;
  seq_num INTEGER;
BEGIN
  IF NEW.batch_id IS NOT NULL AND NEW.uid IS NULL THEN
    batch_num := replace(replace(NEW.batch_id, 'PO-', ''), 'PO', '');
    batch_num := ltrim(batch_num, '0');
    IF batch_num = '' THEN batch_num := '0'; END IF;

    UPDATE public.purchase_batches
    SET unit_counter = unit_counter + 1
    WHERE id = NEW.batch_id
    RETURNING unit_counter INTO seq_num;

    NEW.uid := 'PO' || batch_num || '-' || seq_num::text;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_reserve_stock_unit_uids(p_batch_id text, p_count integer)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_counter INTEGER;
  v_batch_num TEXT;
  v_uids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_count <= 0 THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  UPDATE public.purchase_batches
  SET unit_counter = unit_counter + p_count
  WHERE id = p_batch_id
  RETURNING unit_counter - p_count INTO v_old_counter;

  IF v_old_counter IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  v_batch_num := replace(replace(p_batch_id, 'PO-', ''), 'PO', '');
  v_batch_num := ltrim(v_batch_num, '0');
  IF v_batch_num = '' THEN v_batch_num := '0'; END IF;

  FOR i IN 1..p_count LOOP
    v_uids := array_append(v_uids, 'PO' || v_batch_num || '-' || (v_old_counter + i)::text);
  END LOOP;

  RETURN v_uids;
END;
$$;