-- QBO Integration Fixes: indexes, constraints, atomic stock allocation, helper functions

-- ═══════════════════════════════════════════════════════════
-- 1. Missing indexes for performance
-- ═══════════════════════════════════════════════════════════

-- Customer FK index for JOIN performance on sales_order
CREATE INDEX IF NOT EXISTS idx_sales_order_customer_id
  ON public.sales_order(customer_id);

-- Admin alert dashboard query performance
CREATE INDEX IF NOT EXISTS idx_admin_alert_category_ack
  ON public.admin_alert(category, acknowledged, created_at DESC);

-- Doc number dedup: prevent duplicate orders from QBO webhook + sync race
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_doc_number_unique
  ON public.sales_order(doc_number) WHERE doc_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 2. CHECK constraints for data integrity
-- ═══════════════════════════════════════════════════════════

-- Constrain qbo_sync_status to known values
DO $$ BEGIN
  ALTER TABLE public.sales_order
    ADD CONSTRAINT chk_qbo_sync_status
    CHECK (qbo_sync_status IS NULL OR qbo_sync_status IN ('pending', 'synced', 'retrying', 'failed', 'needs_manual_review'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Constrain retry count to non-negative
DO $$ BEGIN
  ALTER TABLE public.sales_order
    ADD CONSTRAINT chk_qbo_retry_count_positive
    CHECK (qbo_retry_count IS NULL OR qbo_retry_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 3. Atomic stock allocation function (prevents race conditions)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION allocate_stock_units(
  p_sku_id uuid,
  p_quantity int,
  p_order_line_ids uuid[] DEFAULT NULL
) RETURNS uuid[] AS $$
DECLARE
  v_unit_ids uuid[];
  v_count int;
BEGIN
  -- SELECT FOR UPDATE SKIP LOCKED prevents concurrent allocation
  -- FIFO ordering by created_at ensures oldest units are allocated first
  SELECT array_agg(id) INTO v_unit_ids
  FROM (
    SELECT id
    FROM public.stock_unit
    WHERE sku_id = p_sku_id
      AND status IN ('available', 'received', 'graded')
    ORDER BY created_at ASC
    LIMIT p_quantity
    FOR UPDATE SKIP LOCKED
  ) sub;

  v_count := coalesce(array_length(v_unit_ids, 1), 0);

  IF v_count > 0 THEN
    UPDATE public.stock_unit
    SET status = 'closed', updated_at = now()
    WHERE id = ANY(v_unit_ids);
  END IF;

  RETURN coalesce(v_unit_ids, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- 4. SKU code parsing function (canonical, shared by all functions)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION parse_sku_code(p_sku_code text)
RETURNS TABLE(mpn text, condition_grade text) AS $$
DECLARE
  v_trimmed text;
  v_dot_idx int;
  v_mpn text;
  v_grade text;
BEGIN
  v_trimmed := trim(p_sku_code);
  v_dot_idx := position('.' in v_trimmed);

  IF v_dot_idx > 0 THEN
    v_mpn := substring(v_trimmed from 1 for v_dot_idx - 1);
    v_grade := substring(v_trimmed from v_dot_idx + 1);
    IF v_grade = '' THEN v_grade := '1'; END IF;
  ELSE
    v_mpn := v_trimmed;
    v_grade := '1';
  END IF;

  IF v_grade NOT IN ('1', '2', '3', '4', '5') THEN
    v_grade := '1';
  END IF;

  RETURN QUERY SELECT v_mpn, v_grade;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ═══════════════════════════════════════════════════════════
-- 5. Ensure product exists function (atomically find-or-create)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ensure_product_exists(
  p_mpn text,
  p_brand text DEFAULT NULL,
  p_item_type text DEFAULT 'set',
  p_name text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_product_id uuid;
  v_catalog record;
BEGIN
  -- Try existing product first
  SELECT id INTO v_product_id
  FROM public.product
  WHERE mpn = p_mpn
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    -- Update brand/type if provided and not already set
    IF p_brand IS NOT NULL OR p_item_type IS NOT NULL THEN
      UPDATE public.product
      SET brand = coalesce(p_brand, brand),
          product_type = coalesce(p_item_type, product_type)
      WHERE id = v_product_id;
    END IF;
    RETURN v_product_id;
  END IF;

  -- Try creating from lego_catalog
  SELECT id, name, theme_id, piece_count, release_year, retired_flag,
         img_url, subtheme_name, product_type
  INTO v_catalog
  FROM public.lego_catalog
  WHERE mpn = p_mpn AND status = 'active'
  LIMIT 1;

  IF v_catalog IS NOT NULL THEN
    INSERT INTO public.product (
      mpn, name, theme_id, piece_count, release_year, retired_flag,
      img_url, subtheme_name, product_type, lego_catalog_id, status, brand
    ) VALUES (
      p_mpn, v_catalog.name, v_catalog.theme_id, v_catalog.piece_count,
      v_catalog.release_year, coalesce(v_catalog.retired_flag, false),
      v_catalog.img_url, v_catalog.subtheme_name,
      coalesce(p_item_type, v_catalog.product_type, 'set'),
      v_catalog.id, 'active', p_brand
    )
    ON CONFLICT (mpn) DO UPDATE SET
      brand = coalesce(EXCLUDED.brand, product.brand),
      product_type = coalesce(EXCLUDED.product_type, product.product_type)
    RETURNING id INTO v_product_id;

    RETURN v_product_id;
  END IF;

  -- Fallback: create minimal product
  INSERT INTO public.product (mpn, name, product_type, brand, status)
  VALUES (
    p_mpn,
    coalesce(p_name, p_mpn),
    coalesce(p_item_type, 'set'),
    p_brand,
    'active'
  )
  ON CONFLICT (mpn) DO UPDATE SET
    brand = coalesce(EXCLUDED.brand, product.brand),
    product_type = coalesce(EXCLUDED.product_type, product.product_type)
  RETURNING id INTO v_product_id;

  RETURN v_product_id;
END;
$$ LANGUAGE plpgsql;
