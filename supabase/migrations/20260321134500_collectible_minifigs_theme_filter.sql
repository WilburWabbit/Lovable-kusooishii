-- Ensure minifigs can be browsed under both their actual theme and
-- the synthetic Collectible Minifigures storefront theme.

INSERT INTO public.theme (name, slug)
SELECT 'Collectible Minifigures', 'collectible-minifigures'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.theme
  WHERE slug = 'collectible-minifigures'
);

DROP FUNCTION IF EXISTS public.browse_catalog(text, uuid, text, boolean);

CREATE FUNCTION public.browse_catalog(
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
  release_year integer,
  piece_count integer,
  min_price numeric,
  best_grade text,
  total_stock bigint,
  img_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.id AS product_id,
    p.mpn,
    p.name,
    COALESCE(t.name, CASE WHEN p.product_type = 'minifig' THEN cmf.name END) AS theme_name,
    COALESCE(p.theme_id, CASE WHEN p.product_type = 'minifig' THEN cmf.id END) AS theme_id,
    p.retired_flag,
    p.release_year,
    p.piece_count,
    MIN(s.price) AS min_price,
    MIN(s.condition_grade::text) AS best_grade,
    COUNT(DISTINCT su.id) AS total_stock,
    COALESCE(
      primary_media.original_url,
      first_media.original_url,
      catalog_image.img_url,
      p.img_url
    ) AS img_url
  FROM product p
  LEFT JOIN theme t ON t.id = p.theme_id
  LEFT JOIN LATERAL (
    SELECT id, name
    FROM theme
    WHERE slug = 'collectible-minifigures'
    LIMIT 1
  ) cmf ON true
  LEFT JOIN LATERAL (
    SELECT ma.original_url
    FROM product_media pm
    JOIN media_asset ma ON ma.id = pm.media_asset_id
    WHERE pm.product_id = p.id
      AND pm.is_primary = true
    ORDER BY pm.sort_order ASC, pm.created_at ASC, pm.id ASC
    LIMIT 1
  ) primary_media ON true
  LEFT JOIN LATERAL (
    SELECT ma.original_url
    FROM product_media pm
    JOIN media_asset ma ON ma.id = pm.media_asset_id
    WHERE pm.product_id = p.id
    ORDER BY pm.sort_order ASC, pm.created_at ASC, pm.id ASC
    LIMIT 1
  ) first_media ON true
  LEFT JOIN LATERAL (
    SELECT lc.img_url
    FROM lego_catalog lc
    WHERE lc.img_url IS NOT NULL
      AND (lc.id = p.lego_catalog_id OR lc.mpn = p.mpn)
    ORDER BY
      CASE WHEN lc.id = p.lego_catalog_id THEN 0 ELSE 1 END,
      lc.created_at ASC,
      lc.id ASC
    LIMIT 1
  ) catalog_image ON true
  JOIN sku s
    ON s.product_id = p.id
   AND s.active_flag = true
   AND s.saleable_flag = true
  JOIN channel_listing cl
    ON cl.sku_id = s.id
   AND cl.channel = 'web'
   AND cl.offer_status = 'PUBLISHED'
  JOIN stock_unit su
    ON su.sku_id = s.id
   AND su.status = 'available'
  WHERE p.status = 'active'
    AND (search_term IS NULL OR p.name ILIKE '%' || search_term || '%' OR p.mpn ILIKE '%' || search_term || '%')
    AND (
      filter_theme_id IS NULL
      OR p.theme_id = filter_theme_id
      OR (
        p.product_type = 'minifig'
        AND cmf.id IS NOT NULL
        AND filter_theme_id = cmf.id
      )
    )
    AND (filter_grade IS NULL OR s.condition_grade::text = filter_grade)
    AND (filter_retired IS NULL OR p.retired_flag = filter_retired)
  GROUP BY
    p.id,
    p.mpn,
    p.name,
    t.name,
    p.theme_id,
    p.product_type,
    cmf.id,
    cmf.name,
    p.retired_flag,
    p.release_year,
    p.piece_count,
    p.img_url,
    primary_media.original_url,
    first_media.original_url,
    catalog_image.img_url
  ORDER BY p.name;
$function$;
