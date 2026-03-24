-- Remove overly permissive public SELECT policy on sku table
-- that exposes avg_cost, floor_price, cost_range to anonymous users.
-- Admin/staff access is already covered by the "SKUs managed by staff" ALL policy.
DROP POLICY IF EXISTS "SKUs readable by all" ON public.sku;

-- Create a restricted public view that excludes cost fields for storefront use
CREATE OR REPLACE VIEW public.sku_public AS
  SELECT id, sku_code, name, condition_grade, price, sale_price,
         product_id, active_flag, saleable_flag, condition_notes, mpn,
         market_price, created_at, updated_at
  FROM public.sku;

GRANT SELECT ON public.sku_public TO anon, authenticated;