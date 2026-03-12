DROP FUNCTION IF EXISTS public.browse_catalog(text, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.browse_catalog(search_term text DEFAULT NULL::text, filter_theme_id uuid DEFAULT NULL::uuid, filter_grade text DEFAULT NULL::text, filter_retired boolean DEFAULT NULL::boolean)
 RETURNS TABLE(product_id uuid, mpn text, name text, theme_name text, theme_id uuid, retired_flag boolean, release_year integer, piece_count integer, min_price numeric, best_grade text, total_stock bigint, img_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id AS product_id, p.mpn, p.name, t.name AS theme_name, p.theme_id,
    p.retired_flag, p.release_year, p.piece_count,
    MIN(s.price) AS min_price,
    MIN(s.condition_grade::text) AS best_grade,
    COUNT(su.id) AS total_stock,
    p.img_url
  FROM product p
  LEFT JOIN theme t ON t.id = p.theme_id
  JOIN sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN channel_listing cl ON cl.sku_id = s.id AND cl.channel = 'web' AND cl.offer_status = 'PUBLISHED'
  JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
  WHERE p.status = 'active'
    AND (search_term IS NULL OR p.name ILIKE '%' || search_term || '%' OR p.mpn ILIKE '%' || search_term || '%')
    AND (filter_theme_id IS NULL OR p.theme_id = filter_theme_id)
    AND (filter_grade IS NULL OR s.condition_grade::text = filter_grade)
    AND (filter_retired IS NULL OR p.retired_flag = filter_retired)
  GROUP BY p.id, p.mpn, p.name, t.name, p.theme_id, p.retired_flag, p.release_year, p.piece_count, p.img_url
  ORDER BY p.name;
$function$