-- Backfill sku.mpn from sku_code where the format is MPN.grade and the product exists.
-- This ensures the v2_variant_stock_summary view (which JOINs on sku.mpn) returns
-- variants for products whose SKUs were created without an explicit mpn value.
UPDATE sku
SET mpn = regexp_replace(sku_code, '\.[1-5]$', '')
WHERE mpn IS NULL
  AND sku_code ~ '^[A-Za-z0-9-]+\.[1-5]$'
  AND EXISTS (
    SELECT 1 FROM product p
    WHERE p.mpn = regexp_replace(sku.sku_code, '\.[1-5]$', '')
  );

-- Defensive trigger: when a sku is inserted/updated without mpn but the sku_code
-- parses as MPN.grade and the product exists, populate mpn automatically.
CREATE OR REPLACE FUNCTION public.sku_autofill_mpn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
  IF NEW.mpn IS NULL AND NEW.sku_code ~ ''^[A-Za-z0-9-]+\.[1-5]$'' THEN
    NEW.mpn := regexp_replace(NEW.sku_code, ''\.[1-5]$'', '''');
    -- Only keep if the product actually exists, otherwise leave NULL
    IF NOT EXISTS (SELECT 1 FROM product p WHERE p.mpn = NEW.mpn) THEN
      NEW.mpn := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS trg_sku_autofill_mpn ON sku;
CREATE TRIGGER trg_sku_autofill_mpn
BEFORE INSERT OR UPDATE OF sku_code, mpn ON sku
FOR EACH ROW EXECUTE FUNCTION public.sku_autofill_mpn();
