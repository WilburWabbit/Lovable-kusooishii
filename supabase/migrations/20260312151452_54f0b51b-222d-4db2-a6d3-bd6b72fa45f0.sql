
-- 1. Add sku_code column to inbound_receipt_line
ALTER TABLE public.inbound_receipt_line
  ADD COLUMN IF NOT EXISTS sku_code text;

-- 2. Backfill existing sku_code values from mpn + condition_grade
UPDATE public.inbound_receipt_line
SET sku_code = CASE
  WHEN condition_grade IS NOT NULL AND condition_grade != '1' THEN mpn || '.' || condition_grade
  ELSE mpn
END
WHERE mpn IS NOT NULL AND sku_code IS NULL;

-- 3. Convert existing sku_code values in sku table from -G format to dot format
-- e.g. '10311-1-G1' → '10311-1.1', '10311-1-G3' → '10311-1.3'
UPDATE public.sku
SET sku_code = regexp_replace(sku_code, '-G(\d)$', '.\1')
WHERE sku_code ~ '-G\d$';
