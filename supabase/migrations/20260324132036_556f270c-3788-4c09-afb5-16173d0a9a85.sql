CREATE OR REPLACE FUNCTION public.ensure_product_exists(
  p_mpn text,
  p_name text DEFAULT NULL::text,
  p_brand text DEFAULT NULL::text,
  p_item_type text DEFAULT NULL::text,
  p_theme_id uuid DEFAULT NULL::uuid,
  p_subtheme text DEFAULT NULL::text,
  p_piece_count integer DEFAULT NULL::integer,
  p_release_year integer DEFAULT NULL::integer,
  p_retired boolean DEFAULT false,
  p_img_url text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_product_id uuid; v_catalog_id uuid;
BEGIN
  -- Check if product already exists
  SELECT id INTO v_product_id FROM public.product WHERE mpn = p_mpn LIMIT 1;
  IF v_product_id IS NOT NULL THEN
    -- Update brand/product_type if provided and not already set
    IF p_brand IS NOT NULL OR p_item_type IS NOT NULL THEN
      UPDATE public.product
      SET brand = COALESCE(p_brand, brand),
          product_type = COALESCE(p_item_type, product_type)
      WHERE id = v_product_id;
    END IF;
    RETURN v_product_id;
  END IF;

  -- Try to find a catalog entry for enrichment
  SELECT id INTO v_catalog_id FROM public.lego_catalog WHERE mpn = p_mpn LIMIT 1;

  -- Create product with catalog data if available
  IF v_catalog_id IS NOT NULL THEN
    INSERT INTO public.product (mpn, name, brand, product_type, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, lego_catalog_id, status)
    SELECT p_mpn,
           COALESCE(p_name, lc.name),
           COALESCE(p_brand, 'LEGO'),
           COALESCE(p_item_type, lc.product_type, 'set'),
           COALESCE(p_theme_id, lc.theme_id),
           COALESCE(p_subtheme, lc.subtheme_name),
           COALESCE(p_piece_count, lc.piece_count),
           COALESCE(p_release_year, lc.release_year),
           COALESCE(p_retired, lc.retired_flag),
           COALESCE(p_img_url, lc.img_url),
           lc.id,
           'active'
    FROM public.lego_catalog lc WHERE lc.id = v_catalog_id
    RETURNING id INTO v_product_id;
  ELSE
    INSERT INTO public.product (mpn, name, brand, product_type, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, status)
    VALUES (p_mpn, p_name, p_brand, COALESCE(p_item_type, 'set'), p_theme_id, p_subtheme, p_piece_count, p_release_year, p_retired, p_img_url, 'active')
    RETURNING id INTO v_product_id;
  END IF;

  RETURN v_product_id;
END;
$function$;