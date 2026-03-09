
-- Add subtheme_name and img_url columns to catalog_product
ALTER TABLE public.catalog_product ADD COLUMN IF NOT EXISTS subtheme_name text;
ALTER TABLE public.catalog_product ADD COLUMN IF NOT EXISTS img_url text;

-- Create RPC: search_catalog_for_wishlist
CREATE OR REPLACE FUNCTION public.search_catalog_for_wishlist(
  search_term text DEFAULT NULL,
  filter_theme text DEFAULT NULL,
  filter_subtheme text DEFAULT NULL,
  filter_year int DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid, mpn text, name text, theme_name text, subtheme_name text, release_year int, img_url text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    cp.id AS product_id,
    cp.mpn,
    cp.name,
    t.name AS theme_name,
    cp.subtheme_name,
    cp.release_year,
    cp.img_url
  FROM catalog_product cp
  LEFT JOIN theme t ON t.id = cp.theme_id
  WHERE cp.status = 'active'
    AND (search_term IS NULL OR search_term = '' OR cp.name ILIKE '%' || search_term || '%' OR cp.mpn ILIKE '%' || search_term || '%')
    AND (filter_theme IS NULL OR filter_theme = '' OR t.name = filter_theme)
    AND (filter_subtheme IS NULL OR filter_subtheme = '' OR cp.subtheme_name = filter_subtheme)
    AND (filter_year IS NULL OR cp.release_year = filter_year)
  ORDER BY cp.name
  LIMIT 100;
$$;

-- Create RPC: catalog_filter_options
-- Returns valid options for each dropdown based on the OTHER active filters
CREATE OR REPLACE FUNCTION public.catalog_filter_options(
  search_term text DEFAULT NULL,
  filter_theme text DEFAULT NULL,
  filter_subtheme text DEFAULT NULL,
  filter_year int DEFAULT NULL
)
RETURNS TABLE(themes text[], subthemes text[], years int[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH base AS (
    SELECT cp.id, t.name AS theme_name, cp.subtheme_name, cp.release_year
    FROM catalog_product cp
    LEFT JOIN theme t ON t.id = cp.theme_id
    WHERE cp.status = 'active'
      AND (search_term IS NULL OR search_term = '' OR cp.name ILIKE '%' || search_term || '%' OR cp.mpn ILIKE '%' || search_term || '%')
  ),
  valid_themes AS (
    SELECT ARRAY_AGG(DISTINCT theme_name ORDER BY theme_name) AS themes
    FROM base
    WHERE (filter_subtheme IS NULL OR filter_subtheme = '' OR subtheme_name = filter_subtheme)
      AND (filter_year IS NULL OR release_year = filter_year)
  ),
  valid_subthemes AS (
    SELECT ARRAY_AGG(DISTINCT subtheme_name ORDER BY subtheme_name) AS subthemes
    FROM base
    WHERE subtheme_name IS NOT NULL AND subtheme_name != ''
      AND (filter_theme IS NULL OR filter_theme = '' OR theme_name = filter_theme)
      AND (filter_year IS NULL OR release_year = filter_year)
  ),
  valid_years AS (
    SELECT ARRAY_AGG(DISTINCT release_year ORDER BY release_year) AS years
    FROM base
    WHERE release_year IS NOT NULL
      AND (filter_theme IS NULL OR filter_theme = '' OR theme_name = filter_theme)
      AND (filter_subtheme IS NULL OR filter_subtheme = '' OR subtheme_name = filter_subtheme)
  )
  SELECT
    COALESCE(vt.themes, '{}'),
    COALESCE(vs.subthemes, '{}'),
    COALESCE(vy.years, '{}')
  FROM valid_themes vt, valid_subthemes vs, valid_years vy;
$$;
