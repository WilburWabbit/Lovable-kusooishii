
-- Add missing columns
ALTER TABLE public.sku ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.catalog_product ADD COLUMN IF NOT EXISTS description text;

-- Browse catalog function
CREATE OR REPLACE FUNCTION public.browse_catalog(
  search_term text DEFAULT NULL,
  filter_theme_id uuid DEFAULT NULL,
  filter_grade text DEFAULT NULL,
  filter_retired boolean DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  mpn text,
  name text,
  theme_name text,
  theme_id uuid,
  retired_flag boolean,
  release_year int,
  piece_count int,
  min_price numeric,
  best_grade text,
  total_stock bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id AS product_id,
    cp.mpn,
    cp.name,
    t.name AS theme_name,
    cp.theme_id,
    cp.retired_flag,
    cp.release_year,
    cp.piece_count,
    MIN(s.price) AS min_price,
    MIN(s.condition_grade::text) AS best_grade,
    COUNT(su.id) AS total_stock
  FROM catalog_product cp
  LEFT JOIN theme t ON t.id = cp.theme_id
  JOIN sku s ON s.catalog_product_id = cp.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
  WHERE cp.status = 'active'
    AND (search_term IS NULL OR cp.name ILIKE '%' || search_term || '%' OR cp.mpn ILIKE '%' || search_term || '%')
    AND (filter_theme_id IS NULL OR cp.theme_id = filter_theme_id)
    AND (filter_grade IS NULL OR s.condition_grade::text = filter_grade)
    AND (filter_retired IS NULL OR cp.retired_flag = filter_retired)
  GROUP BY cp.id, cp.mpn, cp.name, t.name, cp.theme_id, cp.retired_flag, cp.release_year, cp.piece_count
  ORDER BY cp.name;
$$;

-- Function to get product detail with SKU offers
CREATE OR REPLACE FUNCTION public.product_detail_offers(p_mpn text)
RETURNS TABLE(
  sku_id uuid,
  sku_code text,
  condition_grade text,
  price numeric,
  stock_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id AS sku_id,
    s.sku_code,
    s.condition_grade::text,
    s.price,
    COUNT(su.id) AS stock_count
  FROM catalog_product cp
  JOIN sku s ON s.catalog_product_id = cp.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
  WHERE cp.mpn = p_mpn AND cp.status = 'active'
  GROUP BY s.id, s.sku_code, s.condition_grade, s.price
  ORDER BY s.condition_grade::text;
$$;
