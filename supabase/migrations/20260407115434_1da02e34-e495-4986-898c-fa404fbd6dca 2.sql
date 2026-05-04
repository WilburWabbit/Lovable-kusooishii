-- Backfill set_number on existing products
UPDATE product
SET set_number = split_part(mpn, '-', 1)
WHERE set_number IS NULL
  AND mpn ~ '^\d+-\d+$';

-- Update ensure_product_exists to derive set_number on insert
CREATE OR REPLACE FUNCTION public.ensure_product_exists(p_mpn text, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_set_number text;
BEGIN
  SELECT id INTO v_id FROM product WHERE mpn = p_mpn;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Derive set_number from MPN (e.g., '75367-1' → '75367')
  IF p_mpn ~ '^\d+-\d+$' THEN
    v_set_number := split_part(p_mpn, '-', 1);
  ELSE
    v_set_number := NULL;
  END IF;

  INSERT INTO product (mpn, name, set_number)
  VALUES (p_mpn, COALESCE(p_name, p_mpn), v_set_number)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;