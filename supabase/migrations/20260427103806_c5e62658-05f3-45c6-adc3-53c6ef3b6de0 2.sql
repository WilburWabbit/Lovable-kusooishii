DO $$
DECLARE
  r RECORD;
  v_grade_text TEXT;
  v_canonical_product_id UUID;
  v_canonical_sku_id UUID;
  v_paren_match TEXT;
  v_clean_name TEXT;
BEGIN
  FOR r IN
    SELECT sk.id        AS bad_sku_id,
           sk.sku_code  AS bad_sku_code,
           sk.mpn       AS true_mpn,
           sk.product_id AS bad_product_id,
           sk.name      AS sku_name,
           p.name       AS bad_product_name
    FROM public.sku sk
    JOIN public.product p ON p.id = sk.product_id
    WHERE sk.sku_code ~ '\([A-Za-z0-9_\-]+\.[1-5]\)$'
      AND sk.sku_code <> sk.mpn
      AND sk.sku_code <> sk.mpn || '.' || sk.condition_grade::text
  LOOP
    v_paren_match := substring(r.bad_sku_code FROM '\(([A-Za-z0-9_\-]+\.[1-5])\)$');
    IF v_paren_match IS NULL THEN CONTINUE; END IF;
    v_grade_text := split_part(v_paren_match, '.', 2);

    v_clean_name := regexp_replace(COALESCE(r.sku_name, r.bad_product_name, r.true_mpn),
                                   '\s*\([^()]*\)\s*$', '');
    v_clean_name := NULLIF(trim(v_clean_name), '');

    SELECT id INTO v_canonical_product_id
    FROM public.product WHERE mpn = r.true_mpn LIMIT 1;

    IF v_canonical_product_id IS NULL THEN
      INSERT INTO public.product (mpn, name, status)
      VALUES (r.true_mpn, COALESCE(v_clean_name, r.true_mpn), 'active')
      RETURNING id INTO v_canonical_product_id;
    END IF;

    SELECT id INTO v_canonical_sku_id
    FROM public.sku
    WHERE product_id = v_canonical_product_id
      AND condition_grade::text = v_grade_text
      AND id <> r.bad_sku_id
    ORDER BY CASE WHEN sku_code = r.true_mpn || '.' || v_grade_text THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_canonical_sku_id IS NOT NULL THEN
      UPDATE public.stock_unit
         SET sku_id = v_canonical_sku_id,
             condition_grade = v_grade_text::condition_grade,
             updated_at = now()
       WHERE sku_id = r.bad_sku_id;

      UPDATE public.sales_order_line SET sku_id = v_canonical_sku_id WHERE sku_id = r.bad_sku_id;
      UPDATE public.channel_listing  SET sku_id = v_canonical_sku_id WHERE sku_id = r.bad_sku_id;
      UPDATE public.price_audit_log  SET sku_id = v_canonical_sku_id WHERE sku_id = r.bad_sku_id;

      DELETE FROM public.sku WHERE id = r.bad_sku_id;
    ELSE
      UPDATE public.sku
         SET sku_code = r.true_mpn || '.' || v_grade_text,
             condition_grade = v_grade_text::condition_grade,
             product_id = v_canonical_product_id,
             name = COALESCE(v_clean_name, name),
             updated_at = now()
       WHERE id = r.bad_sku_id;

      UPDATE public.stock_unit
         SET condition_grade = v_grade_text::condition_grade,
             updated_at = now()
       WHERE sku_id = r.bad_sku_id;
    END IF;

    IF r.bad_product_id IS DISTINCT FROM v_canonical_product_id THEN
      BEGIN
        DELETE FROM public.product
         WHERE id = r.bad_product_id
           AND NOT EXISTS (SELECT 1 FROM public.sku WHERE product_id = r.bad_product_id)
           AND NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = r.bad_product_id);
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END IF;
  END LOOP;

  PERFORM public.v2_recalculate_variant_stats(sk.sku_code)
  FROM public.sku sk
  WHERE sk.mpn IN (
    '5KFC3516BER','38881','40478-1','853998-1','853999-1','854112-1',
    'B0F5B3VGFN','43270-1','PO702','ricardo','TIP0284GRNONE'
  );
END $$;