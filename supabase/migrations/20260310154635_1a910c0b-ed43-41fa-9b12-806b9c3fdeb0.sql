
-- Step 1: Rename catalog_product to lego_catalog
ALTER TABLE catalog_product RENAME TO lego_catalog;

-- Step 2: Create product master table
CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mpn text UNIQUE NOT NULL,
  name text,
  theme_id uuid REFERENCES theme(id),
  subtheme_name text,
  product_type text NOT NULL DEFAULT 'set',
  piece_count integer,
  release_year integer,
  retired_flag boolean NOT NULL DEFAULT false,
  img_url text,
  description text,
  product_hook text,
  call_to_action text,
  highlights text,
  seo_title text,
  seo_description text,
  status text NOT NULL DEFAULT 'active',
  lego_catalog_id uuid REFERENCES lego_catalog(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on product
ALTER TABLE product ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products readable by all"
  ON product FOR SELECT TO public
  USING (true);

CREATE POLICY "Products managed by staff"
  ON product FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- updated_at trigger
CREATE TRIGGER set_product_updated_at
  BEFORE UPDATE ON product
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 3: Seed product from lego_catalog rows that have SKUs
INSERT INTO product (mpn, name, theme_id, subtheme_name, product_type, piece_count, release_year, retired_flag, img_url, description, status, lego_catalog_id, created_at)
SELECT DISTINCT ON (lc.mpn)
  lc.mpn, lc.name, lc.theme_id, lc.subtheme_name, lc.product_type,
  lc.piece_count, lc.release_year, lc.retired_flag, lc.img_url,
  lc.description, lc.status, lc.id,
  lc.created_at
FROM lego_catalog lc
JOIN sku s ON s.catalog_product_id = lc.id
ORDER BY lc.mpn, lc.created_at;

-- Step 4: Add product_id to sku and populate
ALTER TABLE sku ADD COLUMN product_id uuid REFERENCES product(id);

UPDATE sku SET product_id = p.id
FROM lego_catalog lc
JOIN product p ON p.mpn = lc.mpn
WHERE sku.catalog_product_id = lc.id;

-- For SKUs without a catalog match, create product rows from SKU data
INSERT INTO product (mpn, name, status)
SELECT DISTINCT ON (su.mpn) su.mpn, s.name, 'active'
FROM sku s
JOIN stock_unit su ON su.sku_id = s.id
WHERE s.product_id IS NULL
  AND su.mpn IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM product p WHERE p.mpn = su.mpn)
ORDER BY su.mpn, s.created_at;

-- Now link those orphan SKUs
UPDATE sku SET product_id = p.id
FROM stock_unit su
JOIN product p ON p.mpn = su.mpn
WHERE sku.id = su.sku_id
  AND sku.product_id IS NULL;

-- Drop old column
ALTER TABLE sku DROP COLUMN catalog_product_id;

-- Step 5: Add content columns to channel_listing
ALTER TABLE channel_listing ADD COLUMN listing_title text;
ALTER TABLE channel_listing ADD COLUMN listing_description text;

-- Step 7: Recreate DB functions

-- browse_catalog: now queries product table
CREATE OR REPLACE FUNCTION public.browse_catalog(
  search_term text DEFAULT NULL,
  filter_theme_id uuid DEFAULT NULL,
  filter_grade text DEFAULT NULL,
  filter_retired boolean DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid, mpn text, name text, theme_name text, theme_id uuid,
  retired_flag boolean, release_year integer, piece_count integer,
  min_price numeric, best_grade text, total_stock bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    p.id AS product_id, p.mpn, p.name, t.name AS theme_name, p.theme_id,
    p.retired_flag, p.release_year, p.piece_count,
    MIN(s.price) AS min_price,
    MIN(s.condition_grade::text) AS best_grade,
    COUNT(su.id) AS total_stock
  FROM product p
  LEFT JOIN theme t ON t.id = p.theme_id
  JOIN sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
  WHERE p.status = 'active'
    AND (search_term IS NULL OR p.name ILIKE '%' || search_term || '%' OR p.mpn ILIKE '%' || search_term || '%')
    AND (filter_theme_id IS NULL OR p.theme_id = filter_theme_id)
    AND (filter_grade IS NULL OR s.condition_grade::text = filter_grade)
    AND (filter_retired IS NULL OR p.retired_flag = filter_retired)
  GROUP BY p.id, p.mpn, p.name, t.name, p.theme_id, p.retired_flag, p.release_year, p.piece_count
  ORDER BY p.name;
$$;

-- product_detail_offers: now queries product table
CREATE OR REPLACE FUNCTION public.product_detail_offers(p_mpn text)
RETURNS TABLE(sku_id uuid, sku_code text, condition_grade text, price numeric, stock_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    s.id AS sku_id, s.sku_code, s.condition_grade::text, s.price,
    COUNT(su.id) AS stock_count
  FROM product p
  JOIN sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
  WHERE p.mpn = p_mpn AND p.status = 'active'
  GROUP BY s.id, s.sku_code, s.condition_grade, s.price
  ORDER BY s.condition_grade::text;
$$;

-- search_catalog_for_wishlist: queries lego_catalog (renamed)
CREATE OR REPLACE FUNCTION public.search_catalog_for_wishlist(
  search_term text DEFAULT NULL, filter_theme text DEFAULT NULL,
  filter_subtheme text DEFAULT NULL, filter_year integer DEFAULT NULL
)
RETURNS TABLE(product_id uuid, mpn text, name text, theme_name text, subtheme_name text, release_year integer, img_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    lc.id AS product_id, lc.mpn, lc.name, t.name AS theme_name,
    lc.subtheme_name, lc.release_year, lc.img_url
  FROM lego_catalog lc
  LEFT JOIN theme t ON t.id = lc.theme_id
  WHERE lc.status = 'active'
    AND (search_term IS NULL OR search_term = '' OR lc.name ILIKE '%' || search_term || '%' OR lc.mpn ILIKE '%' || search_term || '%')
    AND (filter_theme IS NULL OR filter_theme = '' OR t.name = filter_theme)
    AND (filter_subtheme IS NULL OR filter_subtheme = '' OR lc.subtheme_name = filter_subtheme)
    AND (filter_year IS NULL OR lc.release_year = filter_year)
  ORDER BY lc.name LIMIT 100;
$$;

-- catalog_filter_options: queries lego_catalog (renamed)
CREATE OR REPLACE FUNCTION public.catalog_filter_options(
  search_term text DEFAULT NULL, filter_theme text DEFAULT NULL,
  filter_subtheme text DEFAULT NULL, filter_year integer DEFAULT NULL
)
RETURNS TABLE(themes text[], subthemes text[], years integer[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT lc.id, t.name AS theme_name, lc.subtheme_name, lc.release_year
    FROM lego_catalog lc
    LEFT JOIN theme t ON t.id = lc.theme_id
    WHERE lc.status = 'active'
      AND (search_term IS NULL OR search_term = '' OR lc.name ILIKE '%' || search_term || '%' OR lc.mpn ILIKE '%' || search_term || '%')
  ),
  valid_themes AS (
    SELECT ARRAY_AGG(DISTINCT theme_name ORDER BY theme_name) AS themes FROM base
    WHERE (filter_subtheme IS NULL OR filter_subtheme = '' OR subtheme_name = filter_subtheme)
      AND (filter_year IS NULL OR release_year = filter_year)
  ),
  valid_subthemes AS (
    SELECT ARRAY_AGG(DISTINCT subtheme_name ORDER BY subtheme_name) AS subthemes FROM base
    WHERE subtheme_name IS NOT NULL AND subtheme_name != ''
      AND (filter_theme IS NULL OR filter_theme = '' OR theme_name = filter_theme)
      AND (filter_year IS NULL OR release_year = filter_year)
  ),
  valid_years AS (
    SELECT ARRAY_AGG(DISTINCT release_year ORDER BY release_year) AS years FROM base
    WHERE release_year IS NOT NULL
      AND (filter_theme IS NULL OR filter_theme = '' OR theme_name = filter_theme)
      AND (filter_subtheme IS NULL OR filter_subtheme = '' OR subtheme_name = filter_subtheme)
  )
  SELECT COALESCE(vt.themes, '{}'), COALESCE(vs.subthemes, '{}'), COALESCE(vy.years, '{}')
  FROM valid_themes vt, valid_subthemes vs, valid_years vy;
$$;
