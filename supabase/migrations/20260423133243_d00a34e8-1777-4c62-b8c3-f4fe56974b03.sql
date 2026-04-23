-- ─── 1. Extend purchase_batches with QBO sync columns ──────
ALTER TABLE public.purchase_batches
  ADD COLUMN IF NOT EXISTS qbo_purchase_id text,
  ADD COLUMN IF NOT EXISTS qbo_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qbo_sync_error text,
  ADD COLUMN IF NOT EXISTS qbo_sync_attempted_at timestamptz;

-- ─── 2. QBO account settings table ─────────────────────────
CREATE TABLE IF NOT EXISTS public.qbo_account_settings (
  key text PRIMARY KEY,
  account_id text NOT NULL,
  account_name text,
  account_type text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.qbo_account_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/staff can view QBO account settings" ON public.qbo_account_settings;
CREATE POLICY "Admin/staff can view QBO account settings"
ON public.qbo_account_settings FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'staff'::app_role)
);

DROP POLICY IF EXISTS "Admins can manage QBO account settings" ON public.qbo_account_settings;
CREATE POLICY "Admins can manage QBO account settings"
ON public.qbo_account_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed the three known keys (no account_id yet — admin must configure)
INSERT INTO public.qbo_account_settings (key, account_id, account_name)
VALUES
  ('qbo_inventory_asset_account_id', '', NULL),
  ('qbo_income_account_id', '', NULL),
  ('qbo_cogs_account_id', '', NULL),
  ('qbo_cash_account_id', '', NULL)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Update v2_create_purchase_batch to honour name ─────
CREATE OR REPLACE FUNCTION public.v2_create_purchase_batch(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id text;
  v_supplier_name text;
  v_purchase_date date;
  v_reference text;
  v_supplier_vat boolean;
  v_shared_costs jsonb;
  v_total_shared numeric;
  v_line_items jsonb;
  v_line jsonb;
  v_total_units int := 0;
  v_unique_mpns text[];
  v_mpn text;
  v_name_for_mpn text;
  v_product_id uuid;
  v_sku_id uuid;
  v_sku_id_by_mpn jsonb := '{}'::jsonb;
  v_uids text[];
  v_qty int;
  v_unit_cost numeric;
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT (
    public.has_role(v_actor, 'admin'::app_role)
    OR public.has_role(v_actor, 'staff'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  v_supplier_name := trim(p_input->>'supplier_name');
  IF v_supplier_name IS NULL OR v_supplier_name = '' THEN
    RAISE EXCEPTION 'supplier_name is required';
  END IF;

  v_purchase_date := COALESCE((p_input->>'purchase_date')::date, CURRENT_DATE);
  v_reference := NULLIF(trim(p_input->>'reference'), '');
  v_supplier_vat := COALESCE((p_input->>'supplier_vat_registered')::boolean, false);
  v_shared_costs := COALESCE(p_input->'shared_costs', '{}'::jsonb);
  v_total_shared :=
    COALESCE((v_shared_costs->>'shipping')::numeric, 0)
    + COALESCE((v_shared_costs->>'broker_fee')::numeric, 0)
    + COALESCE((v_shared_costs->>'other')::numeric, 0);

  v_line_items := p_input->'line_items';
  IF v_line_items IS NULL OR jsonb_array_length(v_line_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(v_line_items) LOOP
    IF NULLIF(trim(v_line->>'mpn'), '') IS NULL THEN
      RAISE EXCEPTION 'Line item mpn is required';
    END IF;
    v_qty := (v_line->>'quantity')::int;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Line item % has invalid quantity', v_line->>'mpn';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Line item % has invalid unit_cost', v_line->>'mpn';
    END IF;
    v_total_units := v_total_units + v_qty;
  END LOOP;

  INSERT INTO public.purchase_batches (
    supplier_name, purchase_date, reference,
    supplier_vat_registered, shared_costs, total_shared_costs, status
  ) VALUES (
    v_supplier_name, v_purchase_date, v_reference,
    v_supplier_vat, v_shared_costs, v_total_shared, 'draft'
  )
  RETURNING id INTO v_batch_id;

  SELECT array_agg(DISTINCT trim(elem->>'mpn'))
  INTO v_unique_mpns
  FROM jsonb_array_elements(v_line_items) elem;

  FOREACH v_mpn IN ARRAY v_unique_mpns LOOP
    -- Pick the first non-empty name provided for this MPN, fall back to MPN
    SELECT COALESCE(NULLIF(trim(elem->>'name'), ''), v_mpn)
    INTO v_name_for_mpn
    FROM jsonb_array_elements(v_line_items) elem
    WHERE trim(elem->>'mpn') = v_mpn
      AND NULLIF(trim(elem->>'name'), '') IS NOT NULL
    LIMIT 1;

    IF v_name_for_mpn IS NULL THEN
      v_name_for_mpn := v_mpn;
    END IF;

    -- Insert product OR upgrade placeholder name to real name
    INSERT INTO public.product (mpn, name, set_number)
    VALUES (
      v_mpn,
      v_name_for_mpn,
      CASE WHEN v_mpn ~ '^\d+-\d+$' THEN split_part(v_mpn, '-', 1) ELSE NULL END
    )
    ON CONFLICT (mpn) DO UPDATE
      SET name = CASE
        WHEN public.product.name = public.product.mpn AND EXCLUDED.name <> EXCLUDED.mpn
          THEN EXCLUDED.name
        ELSE public.product.name
      END
    RETURNING id INTO v_product_id;

    -- Placeholder grade-5 SKU
    INSERT INTO public.sku (
      sku_code, product_id, mpn, condition_grade,
      active_flag, saleable_flag, name
    )
    VALUES (
      v_mpn || '.5', v_product_id, v_mpn, '5'::condition_grade,
      true, false, v_name_for_mpn
    )
    ON CONFLICT (sku_code) DO UPDATE
      SET name = CASE
        WHEN public.sku.name = public.sku.mpn AND EXCLUDED.name <> EXCLUDED.mpn
          THEN EXCLUDED.name
        ELSE public.sku.name
      END
    RETURNING id INTO v_sku_id;

    v_sku_id_by_mpn := v_sku_id_by_mpn || jsonb_build_object(v_mpn, v_sku_id::text);
  END LOOP;

  CREATE TEMP TABLE _new_lines (
    id uuid,
    mpn text,
    quantity int,
    unit_cost numeric
  ) ON COMMIT DROP;

  WITH inserted AS (
    INSERT INTO public.purchase_line_items (batch_id, mpn, quantity, unit_cost)
    SELECT v_batch_id,
           trim(elem->>'mpn'),
           (elem->>'quantity')::int,
           (elem->>'unit_cost')::numeric
    FROM jsonb_array_elements(v_line_items) elem
    RETURNING id, mpn, quantity, unit_cost
  )
  INSERT INTO _new_lines SELECT * FROM inserted;

  IF v_total_units > 0 THEN
    v_uids := public.v2_reserve_stock_unit_uids(v_batch_id, v_total_units);
    IF array_length(v_uids, 1) IS DISTINCT FROM v_total_units THEN
      RAISE EXCEPTION 'UID reservation returned % uids, expected %',
        COALESCE(array_length(v_uids, 1), 0), v_total_units;
    END IF;
  END IF;

  INSERT INTO public.stock_unit (
    uid, sku_id, mpn, condition_grade,
    batch_id, line_item_id, landed_cost,
    v2_status, status
  )
  SELECT
    v_uids[seq.unit_index],
    (v_sku_id_by_mpn->>l.mpn)::uuid,
    l.mpn,
    '5'::condition_grade,
    v_batch_id,
    l.id,
    l.unit_cost,
    'purchased',
    'pending_receipt'::stock_unit_status
  FROM (
    SELECT id, mpn, quantity, unit_cost,
           SUM(quantity) OVER (ORDER BY id) - quantity AS prev_total
    FROM _new_lines
  ) l
  CROSS JOIN LATERAL generate_series(1, l.quantity) AS gs(n)
  CROSS JOIN LATERAL (SELECT (l.prev_total + gs.n)::int AS unit_index) seq;

  PERFORM public.v2_calculate_apportioned_costs(v_batch_id);

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'line_item_count', jsonb_array_length(v_line_items),
    'unit_count', v_total_units
  );

  INSERT INTO public.audit_event (
    entity_type, entity_id, trigger_type, actor_type, actor_id,
    source_system, input_json, output_json
  )
  VALUES (
    'purchase_batch',
    gen_random_uuid(),
    'purchase_batch_create',
    'user',
    v_actor,
    'admin_v2',
    p_input,
    v_result
  );

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

-- ─── 4. Reset PO-669 SKU qbo_item_ids for repair ──────────
UPDATE public.sku
SET qbo_item_id = NULL
WHERE id IN (
  SELECT DISTINCT su.sku_id
  FROM public.stock_unit su
  WHERE su.batch_id = 'PO-669'
    AND su.sku_id IS NOT NULL
);

-- Also mark PO-669's qbo_sync_status as pending so it shows the retry button
UPDATE public.purchase_batches
SET qbo_sync_status = 'pending', qbo_sync_error = NULL
WHERE id = 'PO-669';