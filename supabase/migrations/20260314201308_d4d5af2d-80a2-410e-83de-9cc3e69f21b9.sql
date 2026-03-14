
-- Step 1: Create product records for orphan SKUs using stock_unit.mpn
INSERT INTO public.product (mpn, name, product_type, status)
SELECT DISTINCT su.mpn, s.name, 'minifigure', 'active'
FROM public.sku s
JOIN public.stock_unit su ON su.sku_id = s.id
WHERE s.product_id IS NULL
  AND su.mpn IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.product p WHERE p.mpn = su.mpn);

-- Step 2: Link orphan SKUs to the newly created products
UPDATE public.sku
SET product_id = p.id, updated_at = now()
FROM public.product p
JOIN public.stock_unit su ON su.mpn = p.mpn
WHERE su.sku_id = sku.id
  AND sku.product_id IS NULL;
