CREATE OR REPLACE FUNCTION public.ensure_product_exists(p_mpn text, p_name text DEFAULT NULL, p_theme_id uuid DEFAULT NULL, p_subtheme text DEFAULT NULL, p_piece_count integer DEFAULT NULL, p_release_year integer DEFAULT NULL, p_retired boolean DEFAULT false, p_img_url text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_product_id uuid; v_catalog_id uuid;
BEGIN
  -- Check if product already exists
  SELECT id INTO v_product_id FROM public.product WHERE mpn = p_mpn LIMIT 1;
  IF v_product_id IS NOT NULL THEN RETURN v_product_id; END IF;

  -- Try to find a catalog entry for enrichment
  SELECT id INTO v_catalog_id FROM public.lego_catalog WHERE mpn = p_mpn LIMIT 1;

  -- Create product with catalog data if available
  IF v_catalog_id IS NOT NULL THEN
    INSERT INTO public.product (mpn, name, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, lego_catalog_id, status)
    SELECT p_mpn,
           COALESCE(p_name, lc.name),
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
    INSERT INTO public.product (mpn, name, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, status)
    VALUES (p_mpn, p_name, p_theme_id, p_subtheme, p_piece_count, p_release_year, p_retired, p_img_url, 'active')
    RETURNING id INTO v_product_id;
  END IF;

  RETURN v_product_id;
END;
$$;