-- Remove the public SELECT policy we just re-added - it exposes all columns
DROP POLICY IF EXISTS "SKUs readable by all via view" ON public.sku;

-- Recreate the view without security_invoker so it runs as the view owner
-- This is acceptable because the view only exposes non-sensitive columns
CREATE OR REPLACE VIEW public.sku_public AS
  SELECT id, sku_code, name, condition_grade, price, sale_price,
         product_id, active_flag, saleable_flag, condition_notes, mpn,
         market_price, created_at, updated_at
  FROM public.sku;

GRANT SELECT ON public.sku_public TO anon, authenticated;