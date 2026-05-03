-- Rolling operations, reference normalization, G5 saleability, and QBO refresh foundation.
-- Lovable SQL runner note: keep PL/pgSQL bodies single-quoted. Do not use dollar-quoted bodies.

-- ------------------------------------------------------------------------------------------------------------------------
-- 1. G5 Red Card stays saleable and participates in normal listing/pricing/QBO paths.
-- ------------------------------------------------------------------------------------------------------------------------

UPDATE public.sku
SET saleable_flag = true
WHERE condition_grade::text = '5';

-- FIFO fallback must consider G5 Red Card units when the SKU being sold is a G5 SKU.
CREATE OR REPLACE FUNCTION public.allocate_stock_for_order_line(
  p_sales_order_line_id UUID,
  p_requested_stock_unit_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_line public.sales_order_line%ROWTYPE;
  v_unit public.stock_unit%ROWTYPE;
  v_method TEXT;
  v_allocation_id UUID;
  v_cost_event_id UUID;
  v_cogs NUMERIC;
BEGIN
  SELECT * INTO v_line
  FROM public.sales_order_line
  WHERE id = p_sales_order_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order_line % not found'', p_sales_order_line_id;
  END IF;

  IF v_line.stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM public.stock_unit WHERE id = v_line.stock_unit_id FOR UPDATE;
    v_method := ''specific_unit'';
  ELSIF p_requested_stock_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM public.stock_unit
    WHERE id = p_requested_stock_unit_id
      AND sku_id = v_line.sku_id
    FOR UPDATE;
    v_method := ''specific_unit'';
  ELSE
    SELECT su.* INTO v_unit
    FROM public.stock_unit su
    WHERE su.sku_id = v_line.sku_id
      AND su.condition_grade::text IN (''1'', ''2'', ''3'', ''4'', ''5'')
      AND COALESCE(su.v2_status::text, su.status::text) IN (''listed'', ''graded'', ''available'', ''restocked'')
    ORDER BY COALESCE(su.listed_at, su.created_at), su.created_at, su.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    v_method := ''fifo_fallback'';
  END IF;

  IF v_unit.id IS NULL THEN
    UPDATE public.sales_order_line
    SET economics_status = ''needs_allocation'',
        costing_method = COALESCE(costing_method, ''manual_exception'')
    WHERE id = p_sales_order_line_id;

    INSERT INTO public.reconciliation_case (
      case_type,
      severity,
      sales_order_id,
      sales_order_line_id,
      related_entity_type,
      related_entity_id,
      suspected_root_cause,
      recommended_action,
      evidence
    )
    VALUES (
      ''unallocated_order_line'',
      ''high'',
      v_line.sales_order_id,
      v_line.id,
      ''sales_order_line'',
      v_line.id,
      ''No eligible stock unit was available for allocation.'',
      ''Open the order line, allocate a saleable stock unit, then refresh order economics.'',
      jsonb_build_object(''sku_id'', v_line.sku_id)
    );

    RETURN jsonb_build_object(
      ''sales_order_line_id'', p_sales_order_line_id,
      ''allocation_method'', ''manual_exception'',
      ''status'', ''needs_allocation''
    );
  END IF;

  v_cogs := COALESCE(v_unit.carrying_value, v_unit.landed_cost, 0);

  INSERT INTO public.stock_allocation (
    sales_order_id,
    sales_order_line_id,
    sku_id,
    requested_stock_unit_id,
    selected_stock_unit_id,
    allocation_method,
    allocation_source,
    idempotency_key,
    status,
    actor_id,
    allocated_at
  )
  VALUES (
    v_line.sales_order_id,
    v_line.id,
    v_line.sku_id,
    p_requested_stock_unit_id,
    v_unit.id,
    v_method,
    ''domain_rpc'',
    ''sale_line:'' || v_line.id::text,
    ''allocated'',
    p_actor_id,
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET selected_stock_unit_id = EXCLUDED.selected_stock_unit_id,
      allocation_method = EXCLUDED.allocation_method,
      status = ''allocated'',
      updated_at = now()
  RETURNING id INTO v_allocation_id;

  UPDATE public.stock_unit
  SET v2_status = ''sold'',
      sold_at = COALESCE(sold_at, now()),
      order_id = v_line.sales_order_id
  WHERE id = v_unit.id;

  UPDATE public.sales_order_line
  SET stock_unit_id = v_unit.id,
      cogs = v_cogs,
      cogs_amount = v_cogs,
      cogs_source_unit_id = v_unit.id,
      costing_method = v_method,
      economics_status = ''final''
  WHERE id = v_line.id;

  INSERT INTO public.stock_cost_event (
    stock_unit_id,
    sales_order_id,
    sales_order_line_id,
    stock_allocation_id,
    event_type,
    amount,
    currency,
    costing_method,
    carrying_value_before,
    carrying_value_after,
    source,
    idempotency_key,
    metadata,
    event_at
  )
  VALUES (
    v_unit.id,
    v_line.sales_order_id,
    v_line.id,
    v_allocation_id,
    ''sale_cogs'',
    v_cogs,
    ''GBP'',
    v_method,
    v_cogs,
    0,
    ''domain_rpc'',
    ''sale_cogs:'' || v_line.id::text,
    jsonb_build_object(''requested_stock_unit_id'', p_requested_stock_unit_id),
    now()
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      stock_unit_id = EXCLUDED.stock_unit_id
  RETURNING id INTO v_cost_event_id;

  RETURN jsonb_build_object(
    ''sales_order_line_id'', v_line.id,
    ''selected_stock_unit_id'', v_unit.id,
    ''allocation_method'', v_method,
    ''cogs_amount'', v_cogs,
    ''cost_event_id'', v_cost_event_id,
    ''stock_allocation_id'', v_allocation_id,
    ''status'', ''allocated''
  );
END;
';

GRANT EXECUTE ON FUNCTION public.allocate_stock_for_order_line(UUID, UUID, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------
-- 2. Mandatory product data and QBO posting gates.
-- ------------------------------------------------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.queue_qbo_purchase_posting_intent(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.queue_qbo_item_posting_intent(
  p_sku_id UUID,
  p_old_sku_code TEXT DEFAULT NULL,
  p_purchase_cost NUMERIC DEFAULT NULL,
  p_supplier_vat_registered BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_sku public.sku%ROWTYPE;
  v_graded_count INTEGER := 0;
  v_intent_id UUID;
BEGIN
  SELECT * INTO v_sku
  FROM public.sku
  WHERE id = p_sku_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sku % not found'', p_sku_id;
  END IF;

  IF v_sku.qbo_item_id IS NULL THEN
    SELECT COUNT(*) INTO v_graded_count
    FROM public.stock_unit su
    WHERE su.sku_id = p_sku_id
      AND COALESCE(su.v2_status::text, '''') IN (
        ''graded'', ''listed'', ''sold'', ''shipped'', ''delivered'',
        ''payout_received'', ''complete'', ''restocked''
      );

    IF v_graded_count = 0 THEN
      RAISE EXCEPTION ''SKU % has not been graded yet. QBO Item posting is blocked until at least one final graded stock unit exists.'', v_sku.sku_code;
    END IF;
  END IF;

  INSERT INTO public.posting_intent (
    target_system,
    action,
    entity_type,
    entity_id,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    ''qbo'',
    ''upsert_item'',
    ''sku'',
    p_sku_id,
    ''qbo:upsert_item:'' || p_sku_id::text,
    ''pending'',
    jsonb_build_object(
      ''sku_id'', p_sku_id,
      ''sku_code'', v_sku.sku_code,
      ''old_sku_code'', p_old_sku_code,
      ''purchase_cost'', p_purchase_cost,
      ''supplier_vat_registered'', p_supplier_vat_registered,
      ''queued_at'', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN ''pending''
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_item_posting_intent(UUID, TEXT, NUMERIC, BOOLEAN)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_qbo_purchase_posting_intent(
  p_batch_id TEXT,
  p_action TEXT DEFAULT 'create_purchase'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_batch public.purchase_batches%ROWTYPE;
  v_action TEXT := COALESCE(NULLIF(trim(p_action), ''''), ''create_purchase'');
  v_ungraded_count INTEGER := 0;
  v_missing_product_count INTEGER := 0;
  v_intent_id UUID;
BEGIN
  IF v_action NOT IN (''create_purchase'', ''update_purchase'', ''delete_purchase'') THEN
    RAISE EXCEPTION ''unsupported QBO purchase action %'', v_action;
  END IF;

  SELECT * INTO v_batch
  FROM public.purchase_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''purchase batch % not found'', p_batch_id;
  END IF;

  IF v_action = ''create_purchase''
     AND v_batch.qbo_purchase_id IS NOT NULL
     AND COALESCE(v_batch.qbo_sync_status, '''') = ''synced'' THEN
    RETURN NULL;
  END IF;

  IF v_action IN (''create_purchase'', ''update_purchase'') THEN
    SELECT COUNT(*) INTO v_ungraded_count
    FROM public.stock_unit su
    WHERE su.batch_id = p_batch_id
      AND (
        su.sku_id IS NULL
        OR COALESCE(su.v2_status::text, ''purchased'') = ''purchased''
      );

    IF v_ungraded_count > 0 THEN
      RAISE EXCEPTION ''Purchase batch % has % ungraded unit(s). Push to QBO only after grading is complete.'', p_batch_id, v_ungraded_count;
    END IF;

    SELECT COUNT(*) INTO v_missing_product_count
    FROM public.purchase_line_items pli
    LEFT JOIN public.product p ON p.mpn = pli.mpn
    WHERE pli.batch_id = p_batch_id
      AND (
        p.id IS NULL
        OR NULLIF(trim(COALESCE(p.name, '''')), '''') IS NULL
        OR NULLIF(trim(COALESCE(p.brand, '''')), '''') IS NULL
        OR NULLIF(trim(COALESCE(p.ebay_category_id, '''')), '''') IS NULL
      );

    IF v_missing_product_count > 0 THEN
      RAISE EXCEPTION ''Purchase batch % has % line(s) missing required product name, brand, or eBay category.'', p_batch_id, v_missing_product_count;
    END IF;
  END IF;

  INSERT INTO public.posting_intent (
    target_system,
    action,
    entity_type,
    entity_id,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    ''qbo'',
    v_action,
    ''purchase_batch'',
    NULL,
    ''qbo:'' || v_action || '':'' || p_batch_id,
    ''pending'',
    jsonb_build_object(
      ''batch_id'', p_batch_id,
      ''purchase_batch_id'', p_batch_id,
      ''reference'', v_batch.reference,
      ''supplier_name'', v_batch.supplier_name,
      ''qbo_purchase_id'', v_batch.qbo_purchase_id,
      ''queued_at'', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN ''pending''
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_purchase_posting_intent(TEXT, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.v2_create_purchase_batch(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS '
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
  v_brand_for_mpn text;
  v_ebay_category_for_mpn text;
  v_product_id uuid;
  v_sku_id uuid;
  v_sku_id_by_mpn jsonb := ''{}''::jsonb;
  v_uids text[];
  v_qty int;
  v_unit_cost numeric;
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT (
    public.has_role(v_actor, ''admin''::app_role)
    OR public.has_role(v_actor, ''staff''::app_role)
  ) THEN
    RAISE EXCEPTION ''Forbidden: admin or staff role required''
      USING ERRCODE = ''42501'';
  END IF;

  v_supplier_name := trim(p_input->>''supplier_name'');
  IF v_supplier_name IS NULL OR v_supplier_name = '''' THEN
    RAISE EXCEPTION ''supplier_name is required'';
  END IF;

  v_purchase_date := COALESCE((p_input->>''purchase_date'')::date, CURRENT_DATE);
  v_reference := NULLIF(trim(p_input->>''reference''), '''');
  v_supplier_vat := COALESCE((p_input->>''supplier_vat_registered'')::boolean, false);
  v_shared_costs := COALESCE(p_input->''shared_costs'', ''{}''::jsonb);
  v_total_shared :=
    COALESCE((v_shared_costs->>''shipping'')::numeric, 0)
    + COALESCE((v_shared_costs->>''broker_fee'')::numeric, 0)
    + COALESCE((v_shared_costs->>''other'')::numeric, 0);

  v_line_items := p_input->''line_items'';
  IF v_line_items IS NULL OR jsonb_array_length(v_line_items) = 0 THEN
    RAISE EXCEPTION ''At least one line item is required'';
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(v_line_items) LOOP
    IF NULLIF(trim(v_line->>''mpn''), '''') IS NULL THEN
      RAISE EXCEPTION ''Line item mpn is required'';
    END IF;
    IF NULLIF(trim(v_line->>''name''), '''') IS NULL THEN
      RAISE EXCEPTION ''Line item % requires a product name before stock can be created'', v_line->>''mpn'';
    END IF;
    IF NULLIF(trim(v_line->>''brand''), '''') IS NULL THEN
      RAISE EXCEPTION ''Line item % requires a brand before stock can be created'', v_line->>''mpn'';
    END IF;
    IF NULLIF(trim(v_line->>''ebay_category_id''), '''') IS NULL THEN
      RAISE EXCEPTION ''Line item % requires an eBay category before stock can be created'', v_line->>''mpn'';
    END IF;
    v_qty := (v_line->>''quantity'')::int;
    v_unit_cost := (v_line->>''unit_cost'')::numeric;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION ''Line item % has invalid quantity'', v_line->>''mpn'';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION ''Line item % has invalid unit_cost'', v_line->>''mpn'';
    END IF;
    v_total_units := v_total_units + v_qty;
  END LOOP;

  INSERT INTO public.purchase_batches (
    supplier_name, purchase_date, reference,
    supplier_vat_registered, shared_costs, total_shared_costs, status
  ) VALUES (
    v_supplier_name, v_purchase_date, v_reference,
    v_supplier_vat, v_shared_costs, v_total_shared, ''draft''
  )
  RETURNING id INTO v_batch_id;

  SELECT array_agg(DISTINCT trim(elem->>''mpn''))
  INTO v_unique_mpns
  FROM jsonb_array_elements(v_line_items) elem;

  FOREACH v_mpn IN ARRAY v_unique_mpns LOOP
    v_name_for_mpn := NULL;
    v_brand_for_mpn := NULL;
    v_ebay_category_for_mpn := NULL;

    SELECT
      NULLIF(trim(elem->>''name''), ''''),
      NULLIF(trim(COALESCE(elem->>''brand'', ''LEGO'')), ''''),
      NULLIF(trim(elem->>''ebay_category_id''), '''')
    INTO v_name_for_mpn, v_brand_for_mpn, v_ebay_category_for_mpn
    FROM jsonb_array_elements(v_line_items) elem
    WHERE trim(elem->>''mpn'') = v_mpn
    LIMIT 1;

    IF v_name_for_mpn IS NULL OR v_brand_for_mpn IS NULL OR v_ebay_category_for_mpn IS NULL THEN
      RAISE EXCEPTION ''MPN % is missing required product name, brand, or eBay category'', v_mpn;
    END IF;

    INSERT INTO public.product (mpn, name, brand, ebay_category_id, set_number)
    VALUES (
      v_mpn,
      v_name_for_mpn,
      v_brand_for_mpn,
      v_ebay_category_for_mpn,
      CASE WHEN v_mpn ~ ''^\d+-\d+$'' THEN split_part(v_mpn, ''-'', 1) ELSE NULL END
    )
    ON CONFLICT (mpn) DO UPDATE
      SET name = CASE
            WHEN public.product.name = public.product.mpn AND EXCLUDED.name <> EXCLUDED.mpn
              THEN EXCLUDED.name
            ELSE public.product.name
          END,
          brand = CASE
            WHEN NULLIF(trim(COALESCE(public.product.brand, '''')), '''') IS NULL
              THEN EXCLUDED.brand
            ELSE public.product.brand
          END,
          ebay_category_id = CASE
            WHEN NULLIF(trim(COALESCE(public.product.ebay_category_id, '''')), '''') IS NULL
              THEN EXCLUDED.ebay_category_id
            ELSE public.product.ebay_category_id
          END
    RETURNING id INTO v_product_id;

    INSERT INTO public.sku (
      sku_code, product_id, mpn, condition_grade,
      active_flag, saleable_flag, name
    )
    VALUES (
      v_mpn || ''.5'', v_product_id, v_mpn, ''5''::condition_grade,
      true, true, v_name_for_mpn
    )
    ON CONFLICT (sku_code) DO UPDATE
      SET product_id = EXCLUDED.product_id,
          saleable_flag = true,
          name = CASE
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
           trim(elem->>''mpn''),
           (elem->>''quantity'')::int,
           (elem->>''unit_cost'')::numeric
    FROM jsonb_array_elements(v_line_items) elem
    RETURNING id, mpn, quantity, unit_cost
  )
  INSERT INTO _new_lines SELECT * FROM inserted;

  IF v_total_units > 0 THEN
    v_uids := public.v2_reserve_stock_unit_uids(v_batch_id, v_total_units);
    IF array_length(v_uids, 1) IS DISTINCT FROM v_total_units THEN
      RAISE EXCEPTION ''UID reservation returned % uids, expected %'',
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
    ''5''::condition_grade,
    v_batch_id,
    l.id,
    l.unit_cost,
    ''purchased'',
    ''pending_receipt''::stock_unit_status
  FROM (
    SELECT id, mpn, quantity, unit_cost,
           SUM(quantity) OVER (ORDER BY id) - quantity AS prev_total
    FROM _new_lines
  ) l
  CROSS JOIN LATERAL generate_series(1, l.quantity) AS gs(n)
  CROSS JOIN LATERAL (SELECT (l.prev_total + gs.n)::int AS unit_index) seq;

  PERFORM public.v2_calculate_apportioned_costs(v_batch_id);

  v_result := jsonb_build_object(
    ''batch_id'', v_batch_id,
    ''line_item_count'', jsonb_array_length(v_line_items),
    ''unit_count'', v_total_units
  );

  INSERT INTO public.audit_event (
    entity_type, entity_id, trigger_type, actor_type, actor_id,
    source_system, input_json, output_json
  )
  VALUES (
    ''purchase_batch'',
    gen_random_uuid(),
    ''purchase_batch_create'',
    ''user'',
    v_actor,
    ''admin_v2'',
    p_input,
    v_result
  );

  RETURN v_result;
END;
';

GRANT EXECUTE ON FUNCTION public.v2_create_purchase_batch(jsonb) TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------
-- 3. Rolling Blue Bell settlement helper.
-- ------------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settle_sales_program_accruals(
  p_program_code TEXT,
  p_accrual_ids UUID[],
  p_actor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_program_id UUID;
  v_settlement_id UUID;
  v_period_start DATE;
  v_period_end DATE;
  v_accrual_count INTEGER := 0;
BEGIN
  IF p_accrual_ids IS NULL OR array_length(p_accrual_ids, 1) IS NULL THEN
    RAISE EXCEPTION ''At least one accrual id is required'';
  END IF;

  SELECT id INTO v_program_id
  FROM public.sales_program
  WHERE program_code = p_program_code;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION ''sales_program % not found'', p_program_code;
  END IF;

  SELECT
    MIN(so.created_at::date),
    MAX(so.created_at::date),
    COUNT(*)
  INTO v_period_start, v_period_end, v_accrual_count
  FROM public.sales_program_accrual spa
  JOIN public.sales_order so ON so.id = spa.sales_order_id
  WHERE spa.sales_program_id = v_program_id
    AND spa.id = ANY(p_accrual_ids)
    AND spa.status IN (''open'', ''partially_settled'')
    AND spa.settlement_id IS NULL;

  IF v_accrual_count = 0 THEN
    RAISE EXCEPTION ''No open accruals were eligible for settlement'';
  END IF;

  INSERT INTO public.sales_program_settlement (
    sales_program_id,
    period_start,
    period_end,
    status,
    gross_sales_amount,
    discount_amount,
    commission_amount,
    reversed_amount,
    notes,
    created_by
  )
  SELECT
    v_program_id,
    COALESCE(v_period_start, CURRENT_DATE),
    COALESCE(v_period_end, CURRENT_DATE),
    ''draft'',
    COALESCE(SUM(so.gross_total), 0),
    COALESCE(SUM(spa.discount_amount), 0),
    COALESCE(SUM(spa.commission_amount), 0),
    COALESCE(SUM(spa.reversed_amount), 0),
    p_notes,
    p_actor_id
  FROM public.sales_program_accrual spa
  JOIN public.sales_order so ON so.id = spa.sales_order_id
  WHERE spa.sales_program_id = v_program_id
    AND spa.id = ANY(p_accrual_ids)
    AND spa.status IN (''open'', ''partially_settled'')
    AND spa.settlement_id IS NULL
  RETURNING id INTO v_settlement_id;

  UPDATE public.sales_program_accrual
  SET settlement_id = v_settlement_id,
      status = CASE WHEN status = ''open'' THEN ''partially_settled'' ELSE status END,
      updated_at = now()
  WHERE sales_program_id = v_program_id
    AND id = ANY(p_accrual_ids)
    AND status IN (''open'', ''partially_settled'')
    AND settlement_id IS NULL;

  RETURN v_settlement_id;
END;
';

GRANT EXECUTE ON FUNCTION public.settle_sales_program_accruals(TEXT, UUID[], UUID, TEXT)
  TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------
-- 4. Reference normalization and rolling operational views.
-- ------------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.reconciliation_case DROP CONSTRAINT IF EXISTS reconciliation_case_case_type_check;
ALTER TABLE public.reconciliation_case
  ADD CONSTRAINT reconciliation_case_case_type_check
  CHECK (case_type IN (
    'missing_cogs',
    'unallocated_order_line',
    'unmatched_payout_fee',
    'missing_payout',
    'amount_mismatch',
    'unpaid_program_accrual',
    'qbo_posting_gap',
    'listing_command_failed',
    'duplicate_candidate',
    'qbo_refresh_drift',
    'other'
  ));

DROP VIEW IF EXISTS public.v_reconciliation_case_export;
DROP VIEW IF EXISTS public.v_reconciliation_inbox;
DROP VIEW IF EXISTS public.v_settlement_close_export;
DROP VIEW IF EXISTS public.v_blue_bell_monthly_statement_export;
DROP VIEW IF EXISTS public.v_rolling_settlement_export;
DROP VIEW IF EXISTS public.v_blue_bell_statement_export;
DROP VIEW IF EXISTS public.v_posting_intent_with_references;
DROP VIEW IF EXISTS public.v_outbound_command_with_references;
DROP VIEW IF EXISTS public.v_withheld_payout_monitor;
DROP VIEW IF EXISTS public.v_rolling_settlement_monitor;
DROP VIEW IF EXISTS public.v_blue_bell_accrual_ledger;
DROP VIEW IF EXISTS public.v_entity_reference_columns;
DROP VIEW IF EXISTS public.v_margin_profit_report;

CREATE OR REPLACE VIEW public.v_entity_reference_columns AS
SELECT
  'sales_order'::TEXT AS entity_type,
  so.id AS entity_id,
  so.id::TEXT AS entity_reference,
  so.order_number AS app_reference,
  so.id::TEXT AS uuid_reference,
  COALESCE(so.qbo_sales_receipt_id, qpr.qbo_entity_id) AS qbo_entity_id,
  COALESCE(so.doc_number, qpr.qbo_doc_number) AS qbo_doc_number,
  COALESCE(so.external_order_id, so.origin_reference) AS external_reference,
  CASE WHEN so.origin_channel IN ('stripe', 'website', 'web') THEN COALESCE(so.payment_reference, so.origin_reference) ELSE NULL END AS stripe_reference,
  CASE WHEN so.origin_channel = 'ebay' THEN COALESCE(so.external_order_id, so.origin_reference) ELSE NULL END AS ebay_reference,
  so.created_at
FROM public.sales_order so
LEFT JOIN LATERAL (
  SELECT qbo_entity_id, qbo_doc_number
  FROM public.qbo_posting_reference ref
  WHERE ref.local_entity_type = 'sales_order'
    AND ref.local_entity_id = so.id
  ORDER BY COALESCE(ref.synced_at, ref.created_at) DESC
  LIMIT 1
) qpr ON true

UNION ALL

SELECT
  'purchase_batch',
  NULL::UUID,
  pb.id,
  pb.id,
  NULL::TEXT,
  COALESCE(pb.qbo_purchase_id, qpr.qbo_entity_id),
  qpr.qbo_doc_number,
  pb.reference,
  NULL::TEXT,
  NULL::TEXT,
  pb.created_at
FROM public.purchase_batches pb
LEFT JOIN LATERAL (
  SELECT qbo_entity_id, qbo_doc_number
  FROM public.qbo_posting_reference ref
  WHERE ref.local_entity_type = 'purchase_batch'
    AND (
      ref.metadata->>'local_entity_reference' = pb.id
      OR ref.qbo_entity_id = pb.qbo_purchase_id
    )
  ORDER BY COALESCE(ref.synced_at, ref.created_at) DESC
  LIMIT 1
) qpr ON true

UNION ALL

SELECT
  'payout',
  p.id,
  p.id::TEXT,
  COALESCE(p.external_payout_id, p.id::TEXT),
  p.id::TEXT,
  COALESCE(p.qbo_deposit_id, p.qbo_expense_id, qpr.qbo_entity_id),
  qpr.qbo_doc_number,
  p.external_payout_id,
  CASE WHEN p.channel::text = 'stripe' THEN p.external_payout_id ELSE NULL END,
  CASE WHEN p.channel::text = 'ebay' THEN p.external_payout_id ELSE NULL END,
  p.created_at
FROM public.payouts p
LEFT JOIN LATERAL (
  SELECT qbo_entity_id, qbo_doc_number
  FROM public.qbo_posting_reference ref
  WHERE ref.local_entity_type = 'payout'
    AND ref.local_entity_id = p.id
  ORDER BY COALESCE(ref.synced_at, ref.created_at) DESC
  LIMIT 1
) qpr ON true

UNION ALL

SELECT
  'sku',
  sk.id,
  sk.id::TEXT,
  sk.sku_code,
  sk.id::TEXT,
  COALESCE(sk.qbo_item_id, qpr.qbo_entity_id),
  qpr.qbo_doc_number,
  sk.sku_code,
  NULL::TEXT,
  NULL::TEXT,
  sk.created_at
FROM public.sku sk
LEFT JOIN LATERAL (
  SELECT qbo_entity_id, qbo_doc_number
  FROM public.qbo_posting_reference ref
  WHERE ref.local_entity_type = 'sku'
    AND ref.local_entity_id = sk.id
  ORDER BY COALESCE(ref.synced_at, ref.created_at) DESC
  LIMIT 1
) qpr ON true

UNION ALL

SELECT
  'customer',
  c.id,
  c.id::TEXT,
  COALESCE(c.display_name, c.email, c.id::TEXT),
  c.id::TEXT,
  COALESCE(c.qbo_customer_id, qpr.qbo_entity_id),
  qpr.qbo_doc_number,
  COALESCE(c.email, c.id::TEXT),
  NULL::TEXT,
  NULL::TEXT,
  c.created_at
FROM public.customer c
LEFT JOIN LATERAL (
  SELECT qbo_entity_id, qbo_doc_number
  FROM public.qbo_posting_reference ref
  WHERE ref.local_entity_type = 'customer'
    AND ref.local_entity_id = c.id
  ORDER BY COALESCE(ref.synced_at, ref.created_at) DESC
  LIMIT 1
) qpr ON true;

CREATE OR REPLACE VIEW public.v_rolling_settlement_monitor AS
WITH expected AS (
  SELECT sales_order_id, ROUND(SUM(amount), 2) AS expected_total
  FROM public.expected_settlement_line
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
),
actual AS (
  SELECT sales_order_id, ROUND(SUM(amount), 2) AS actual_total, MAX(occurred_at) AS latest_actual_at
  FROM public.actual_settlement_line
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
),
case_rollup AS (
  SELECT
    sales_order_id,
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_case_count,
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND case_type = 'missing_payout') AS missing_payout_case_count,
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND case_type = 'amount_mismatch') AS amount_mismatch_case_count
  FROM public.reconciliation_case
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
)
SELECT
  so.id AS sales_order_id,
  so.order_number,
  so.origin_channel,
  so.payment_method,
  so.status::TEXT AS order_status,
  so.created_at AS order_created_at,
  refs.app_reference,
  refs.qbo_entity_id,
  refs.qbo_doc_number,
  refs.external_reference,
  refs.stripe_reference,
  refs.ebay_reference,
  COALESCE(e.expected_total, 0) AS expected_total,
  CASE
    WHEN COALESCE(so.payment_method, '') IN ('cash', 'undeposited_funds', 'in_person')
      OR so.origin_channel IN ('cash', 'in_person', 'manual_cash')
      THEN COALESCE(e.expected_total, 0)
    ELSE COALESCE(a.actual_total, 0)
  END AS actual_total,
  ROUND(
    COALESCE(e.expected_total, 0)
    - CASE
        WHEN COALESCE(so.payment_method, '') IN ('cash', 'undeposited_funds', 'in_person')
          OR so.origin_channel IN ('cash', 'in_person', 'manual_cash')
          THEN COALESCE(e.expected_total, 0)
        ELSE COALESCE(a.actual_total, 0)
      END,
    2
  ) AS variance_amount,
  COALESCE(cr.open_case_count, 0) AS open_case_count,
  COALESCE(cr.missing_payout_case_count, 0) AS missing_payout_case_count,
  COALESCE(cr.amount_mismatch_case_count, 0) AS amount_mismatch_case_count,
  a.latest_actual_at,
  CASE
    WHEN COALESCE(so.payment_method, '') IN ('cash', 'undeposited_funds', 'in_person')
      OR so.origin_channel IN ('cash', 'in_person', 'manual_cash')
      THEN 'settled'
    WHEN COALESCE(cr.open_case_count, 0) > 0 THEN 'review'
    WHEN ABS(COALESCE(e.expected_total, 0) - COALESCE(a.actual_total, 0)) <= 0.05 THEN 'settled'
    WHEN so.origin_channel IN ('ebay', 'stripe', 'website', 'web', 'bricklink', 'brickowl') THEN 'awaiting_payout'
    ELSE 'review'
  END AS settlement_status
FROM public.sales_order so
LEFT JOIN expected e ON e.sales_order_id = so.id
LEFT JOIN actual a ON a.sales_order_id = so.id
LEFT JOIN case_rollup cr ON cr.sales_order_id = so.id
LEFT JOIN public.v_entity_reference_columns refs
  ON refs.entity_type = 'sales_order'
 AND refs.entity_id = so.id;

CREATE OR REPLACE VIEW public.v_withheld_payout_monitor AS
SELECT *
FROM public.v_rolling_settlement_monitor
WHERE settlement_status IN ('awaiting_payout', 'review')
  AND origin_channel IN ('ebay', 'stripe', 'website', 'web', 'bricklink', 'brickowl')
  AND COALESCE(payment_method, '') NOT IN ('cash', 'undeposited_funds', 'in_person');

CREATE OR REPLACE VIEW public.v_rolling_settlement_export AS
SELECT *
FROM public.v_rolling_settlement_monitor
ORDER BY order_created_at DESC;

CREATE OR REPLACE VIEW public.v_blue_bell_accrual_ledger AS
SELECT
  spa.id AS accrual_id,
  so.id AS sales_order_id,
  so.order_number,
  so.created_at AS order_created_at,
  so.origin_channel,
  refs.app_reference,
  refs.qbo_entity_id,
  refs.qbo_doc_number,
  refs.external_reference,
  refs.stripe_reference,
  refs.ebay_reference,
  spa.status,
  ROUND(COALESCE(spa.basis_amount, 0), 2) AS basis_amount,
  ROUND(COALESCE(spa.discount_amount, 0), 2) AS discount_amount,
  ROUND(COALESCE(spa.commission_amount, 0), 2) AS commission_amount,
  ROUND(COALESCE(spa.reversed_amount, 0), 2) AS reversed_amount,
  ROUND(COALESCE(spa.commission_amount, 0) - COALESCE(spa.reversed_amount, 0), 2) AS commission_outstanding,
  spa.settlement_id,
  s.status AS settlement_status,
  s.qbo_expense_id,
  s.qbo_payment_reference,
  spa.created_at,
  spa.updated_at
FROM public.sales_program_accrual spa
JOIN public.sales_program sp ON sp.id = spa.sales_program_id
JOIN public.sales_order so ON so.id = spa.sales_order_id
LEFT JOIN public.sales_program_settlement s ON s.id = spa.settlement_id
LEFT JOIN public.v_entity_reference_columns refs
  ON refs.entity_type = 'sales_order'
 AND refs.entity_id = so.id
WHERE sp.program_code = 'blue_bell';

CREATE OR REPLACE VIEW public.v_blue_bell_statement_export AS
SELECT *
FROM public.v_blue_bell_accrual_ledger
ORDER BY order_created_at DESC;

CREATE OR REPLACE VIEW public.v_settlement_close_export AS
SELECT *
FROM public.v_rolling_settlement_export;

CREATE OR REPLACE VIEW public.v_blue_bell_monthly_statement_export AS
SELECT *
FROM public.v_blue_bell_statement_export;

CREATE OR REPLACE VIEW public.v_posting_intent_with_references AS
SELECT
  pi.id,
  pi.target_system,
  pi.action,
  pi.entity_type,
  pi.entity_id,
  pi.status,
  pi.retry_count,
  pi.last_error,
  pi.next_attempt_at,
  pi.qbo_reference_id,
  pi.created_at,
  pi.updated_at,
  pi.posted_at,
  COALESCE(refs.app_reference, pi.payload->>'batch_id', pi.payload->>'purchase_batch_id', pi.entity_id::TEXT) AS app_reference,
  COALESCE(refs.qbo_entity_id, pi.qbo_reference_id) AS qbo_entity_id,
  refs.qbo_doc_number,
  refs.external_reference,
  refs.stripe_reference,
  refs.ebay_reference,
  pi.payload
FROM public.posting_intent pi
LEFT JOIN public.v_entity_reference_columns refs
  ON refs.entity_type = pi.entity_type
 AND (
   refs.entity_id = pi.entity_id
   OR refs.entity_reference = pi.payload->>'batch_id'
   OR refs.entity_reference = pi.payload->>'purchase_batch_id'
 );

CREATE OR REPLACE VIEW public.v_outbound_command_with_references AS
SELECT
  oc.id,
  oc.target_system,
  oc.command_type,
  oc.entity_type,
  oc.entity_id,
  oc.status,
  oc.retry_count,
  oc.last_error,
  oc.next_attempt_at,
  oc.sent_at,
  oc.created_at,
  oc.updated_at,
  COALESCE(cl.external_sku, sk.sku_code, oc.payload->>'sku_code', oc.entity_id::TEXT) AS app_reference,
  cl.external_listing_id,
  cl.channel,
  sk.sku_code,
  sk.mpn,
  oc.payload
FROM public.outbound_command oc
LEFT JOIN public.channel_listing cl
  ON oc.entity_type = 'channel_listing'
 AND cl.id = oc.entity_id
LEFT JOIN public.sku sk ON sk.id = cl.sku_id;

CREATE OR REPLACE VIEW public.v_reconciliation_inbox AS
WITH note_rollup AS (
  SELECT
    n.reconciliation_case_id,
    COUNT(*) AS note_count,
    MAX(n.created_at) AS latest_note_at,
    (array_agg(n.note ORDER BY n.created_at DESC))[1] AS latest_note
  FROM public.reconciliation_case_note n
  GROUP BY n.reconciliation_case_id
)
SELECT
  rc.id,
  rc.case_type,
  rc.severity,
  rc.status,
  rc.sales_order_id,
  so.order_number,
  rc.sales_order_line_id,
  rc.payout_id,
  rc.related_entity_type,
  rc.related_entity_id,
  rc.suspected_root_cause,
  rc.recommended_action,
  rc.amount_expected,
  rc.amount_actual,
  rc.variance_amount,
  NULL::UUID AS owner_id,
  NULL::TIMESTAMPTZ AS due_at,
  rc.created_at,
  rc.updated_at,
  so.origin_channel,
  sol.sku_id,
  sk.sku_code,
  p.external_payout_id,
  p.channel::text AS payout_channel,
  rc.evidence,
  CASE
    WHEN rc.case_type = 'missing_cogs' THEN 'No cost basis has been posted for this sold line. The sale line was finalized before stock allocation or before carrying value existed.'
    WHEN rc.case_type = 'unallocated_order_line' THEN 'The order line has no allocated stock unit, so COGS and final accounting are blocked.'
    WHEN rc.case_type = 'unmatched_payout_fee' THEN 'A payout fee exists but is not linked to a canonical sales order. The external order reference may be missing, malformed, duplicated, or not yet imported.'
    WHEN rc.case_type = 'missing_payout' THEN 'The order looks like marketplace or processor funds are withheld, and no actual payout evidence has been imported or matched yet.'
    WHEN rc.case_type = 'amount_mismatch' THEN 'Expected settlement and actual payout evidence differ beyond tolerance. Common causes are fee timing, partial refunds, shipping adjustments, marketplace holds, or duplicate actual lines.'
    WHEN rc.case_type = 'unpaid_program_accrual' THEN 'A Blue Bell commission accrual is open and not attached to a settlement record yet.'
    WHEN rc.case_type = 'qbo_posting_gap' THEN 'The app has expected accounting events but no successful QBO posting reference.'
    WHEN rc.case_type = 'qbo_refresh_drift' THEN COALESCE(rc.suspected_root_cause, 'QBO wholesale refresh found a mismatch between landed QBO data and app references.')
    WHEN rc.case_type = 'listing_command_failed' THEN 'An outbound listing command failed or exhausted retries before the external channel acknowledged it.'
    WHEN rc.case_type = 'duplicate_candidate' THEN 'More than one possible match exists. Automatic reconciliation is paused to avoid joining the wrong records.'
    ELSE COALESCE(rc.suspected_root_cause, 'No detailed diagnosis has been recorded yet.')
  END AS diagnosis,
  CASE
    WHEN rc.case_type = 'missing_cogs' THEN 'Allocate or correct the stock unit for the line, confirm carrying value, then refresh order economics and rebuild reconciliation cases.'
    WHEN rc.case_type = 'unallocated_order_line' THEN 'Open the order, allocate a saleable stock unit, then refresh order economics. If no stock exists, purchase and grade stock or record a manual exception.'
    WHEN rc.case_type = 'unmatched_payout_fee' THEN 'Use Link to match by external order ID. If it does not match, inspect payout fee external references and import the missing order first.'
    WHEN rc.case_type = 'missing_payout' THEN 'Run settlement refresh. If still missing, import the Stripe/eBay payout or confirm the marketplace has not paid it yet.'
    WHEN rc.case_type = 'amount_mismatch' THEN 'Compare expected versus actual amounts in the export, inspect fee/refund lines, then refresh settlement after correcting the source evidence.'
    WHEN rc.case_type = 'unpaid_program_accrual' THEN 'Open the Blue Bell accrual ledger, select the relevant accruals, and create a settlement record when payment is made or scheduled.'
    WHEN rc.case_type = 'qbo_posting_gap' THEN 'Queue or retry the QBO posting intent. If it fails again, inspect the posting error and source entity data.'
    WHEN rc.case_type = 'qbo_refresh_drift' THEN COALESCE(rc.recommended_action, 'Review the QBO refresh drift evidence and approve only reference/doc-number updates that do not disturb website or eBay listings.')
    WHEN rc.case_type = 'listing_command_failed' THEN 'Open the listing record, fix the channel/listing data named in the error, then retry the command.'
    WHEN rc.case_type = 'duplicate_candidate' THEN 'Review candidates in the evidence payload and choose the correct order/payout link manually.'
    ELSE COALESCE(rc.recommended_action, 'Review the evidence payload and related records, then resolve or ignore with a note.')
  END AS next_step,
  public.reconciliation_case_requires_evidence(rc.case_type) AS requires_evidence,
  NULL::TEXT AS owner_name,
  COALESCE(nr.note_count, 0) AS note_count,
  nr.latest_note_at,
  nr.latest_note,
  'rolling'::TEXT AS sla_status,
  CASE
    WHEN rc.sales_order_id IS NOT NULL THEN '/admin/orders/' || rc.sales_order_id::TEXT
    WHEN rc.payout_id IS NOT NULL THEN '/admin/payouts/' || rc.payout_id::TEXT
    WHEN rc.related_entity_type = 'channel_listing' AND rc.related_entity_id IS NOT NULL THEN '/admin/listings/' || rc.related_entity_id::TEXT
    WHEN rc.related_entity_type = 'purchase_batch' THEN '/admin/purchases/' || COALESCE(rc.evidence->>'purchase_batch_id', rc.evidence->>'local_reference', '')
    WHEN rc.case_type = 'qbo_refresh_drift' THEN '/admin/settings'
    ELSE NULL
  END AS target_route,
  CASE
    WHEN so.order_number IS NOT NULL THEN so.order_number
    WHEN p.external_payout_id IS NOT NULL THEN p.external_payout_id
    WHEN rc.related_entity_type = 'purchase_batch' THEN COALESCE(rc.evidence->>'purchase_batch_id', rc.evidence->>'local_reference')
    WHEN rc.related_entity_id IS NOT NULL THEN rc.related_entity_id::TEXT
    ELSE rc.id::TEXT
  END AS target_label,
  refs.app_reference,
  refs.qbo_entity_id,
  refs.qbo_doc_number,
  COALESCE(refs.external_reference, p.external_payout_id, rc.evidence->>'external_reference') AS external_reference,
  refs.stripe_reference,
  refs.ebay_reference
FROM public.reconciliation_case rc
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
LEFT JOIN public.sales_order_line sol ON sol.id = rc.sales_order_line_id
LEFT JOIN public.sku sk ON sk.id = sol.sku_id
LEFT JOIN public.payouts p ON p.id = rc.payout_id
LEFT JOIN public.v_entity_reference_columns refs
  ON (refs.entity_type = 'sales_order' AND refs.entity_id = so.id)
  OR (refs.entity_type = 'payout' AND refs.entity_id = p.id)
  OR (refs.entity_type = rc.related_entity_type AND refs.entity_id = rc.related_entity_id)
  OR (refs.entity_type = rc.related_entity_type AND refs.entity_reference = rc.evidence->>'local_reference')
LEFT JOIN note_rollup nr ON nr.reconciliation_case_id = rc.id
WHERE rc.status IN ('open', 'in_progress')
ORDER BY
  CASE rc.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  rc.created_at ASC;

CREATE OR REPLACE VIEW public.v_reconciliation_case_export AS
SELECT
  rc.id,
  rc.case_type,
  rc.severity,
  rc.status,
  inbox.app_reference,
  inbox.target_route,
  inbox.target_label,
  inbox.qbo_entity_id,
  inbox.qbo_doc_number,
  inbox.external_reference,
  inbox.stripe_reference,
  inbox.ebay_reference,
  so.order_number,
  so.origin_channel,
  rc.sales_order_id,
  rc.sales_order_line_id,
  sk.sku_code,
  rc.payout_id,
  p.external_payout_id,
  p.channel::text AS payout_channel,
  rc.related_entity_type,
  rc.related_entity_id,
  rc.amount_expected,
  rc.amount_actual,
  rc.variance_amount,
  rc.suspected_root_cause,
  rc.recommended_action,
  inbox.diagnosis,
  inbox.next_step,
  rc.evidence::text AS evidence_json,
  rc.created_at,
  rc.updated_at,
  rc.closed_at,
  rc.close_code,
  inbox.requires_evidence,
  inbox.note_count,
  inbox.latest_note_at,
  inbox.latest_note
FROM public.reconciliation_case rc
LEFT JOIN public.v_reconciliation_inbox inbox ON inbox.id = rc.id
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
LEFT JOIN public.sales_order_line sol ON sol.id = rc.sales_order_line_id
LEFT JOIN public.sku sk ON sk.id = sol.sku_id
LEFT JOIN public.payouts p ON p.id = rc.payout_id;

CREATE OR REPLACE VIEW public.v_margin_profit_report AS
SELECT
  up.stock_unit_id,
  up.uid,
  up.sku,
  sk.mpn,
  p.name AS product_name,
  up.v2_status,
  refs.app_reference,
  refs.qbo_entity_id,
  refs.qbo_doc_number,
  refs.external_reference,
  refs.stripe_reference,
  refs.ebay_reference,
  so.order_number,
  so.origin_channel,
  so.created_at::date AS order_date,
  up.sales_order_id,
  up.sales_order_line_id,
  up.gross_revenue,
  up.landed_cost,
  up.total_fee_amount,
  up.program_commission_amount,
  up.net_profit,
  up.net_margin_pct,
  up.gross_margin_pct,
  up.fee_pct,
  up.batch_id,
  up.payout_id
FROM public.v_unit_profit_v2 up
LEFT JOIN public.sales_order so ON so.id = up.sales_order_id
LEFT JOIN public.sku sk ON sk.sku_code = up.sku
LEFT JOIN public.product p ON p.id = sk.product_id
LEFT JOIN public.v_entity_reference_columns refs
  ON refs.entity_type = 'sales_order'
 AND refs.entity_id = so.id
ORDER BY so.created_at DESC NULLS LAST, up.sku;

CREATE TABLE IF NOT EXISTS public.qbo_refresh_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'approved_apply')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_by UUID,
  requested_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qbo_refresh_drift (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_refresh_run_id UUID NOT NULL REFERENCES public.qbo_refresh_run(id) ON DELETE CASCADE,
  drift_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'applied', 'ignored')),
  qbo_entity_type TEXT NOT NULL,
  qbo_entity_id TEXT,
  qbo_doc_number TEXT,
  local_entity_type TEXT,
  local_entity_id UUID,
  local_reference TEXT,
  app_reference TEXT,
  target_route TEXT,
  current_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  qbo_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_action TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.v_subledger_operations_health AS
WITH job_rollup AS (
  SELECT
    job,
    MAX(occurred_at) FILTER (WHERE job_success IS TRUE) AS last_success_at,
    MAX(occurred_at) FILTER (WHERE job_success IS FALSE) AS last_failure_at
  FROM public.v_subledger_job_run
  GROUP BY job
),
case_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_count,
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND severity IN ('high', 'critical')) AS high_count,
    MIN(created_at) FILTER (WHERE status IN ('open', 'in_progress')) AS oldest_open_at
  FROM public.reconciliation_case
),
qbo_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    MIN(created_at) FILTER (WHERE status IN ('pending', 'failed', 'processing')) AS oldest_pending_at
  FROM public.posting_intent
  WHERE target_system = 'qbo'
),
listing_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    MIN(created_at) FILTER (WHERE status IN ('pending', 'failed', 'processing')) AS oldest_pending_at
  FROM public.outbound_command
  WHERE entity_type = 'channel_listing'
),
withheld_rollup AS (
  SELECT
    COUNT(*) AS open_count,
    COUNT(*) FILTER (WHERE settlement_status = 'review') AS review_count,
    MIN(order_created_at) AS oldest_open_at
  FROM public.v_withheld_payout_monitor
),
blue_bell_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status IN ('open', 'partially_settled')) AS open_count,
    COALESCE(SUM(commission_outstanding) FILTER (WHERE status IN ('open', 'partially_settled')), 0) AS outstanding_amount,
    MIN(created_at) FILTER (WHERE status IN ('open', 'partially_settled')) AS oldest_open_at
  FROM public.v_blue_bell_accrual_ledger
),
market_rollup AS (
  SELECT
    COUNT(*) AS snapshot_count,
    COUNT(*) FILTER (WHERE captured_at < now() - interval '14 days') AS stale_count,
    MAX(captured_at) AS latest_snapshot_at
  FROM public.market_price_snapshot
),
qbo_refresh_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'open') AS open_count,
    MAX(created_at) AS latest_run_at
  FROM public.qbo_refresh_drift
),
scheduled_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE job_success IS FALSE AND occurred_at >= now() - interval '24 hours') AS recent_failure_count,
    MAX(occurred_at) FILTER (WHERE job_success IS TRUE) AS last_success_at,
    MAX(occurred_at) FILTER (WHERE job_success IS FALSE) AS last_failure_at
  FROM public.v_subledger_job_run
)
SELECT
  'reconciliation_cases'::TEXT AS area,
  CASE WHEN cr.high_count > 0 THEN 'blocked' WHEN cr.open_count > 0 THEN 'warning' ELSE 'ready' END AS health_status,
  CASE WHEN cr.high_count > 0 THEN 'high' WHEN cr.open_count > 0 THEN 'medium' ELSE 'low' END AS severity,
  cr.open_count,
  cr.high_count AS failed_count,
  0::BIGINT AS pending_count,
  0::BIGINT AS overdue_count,
  (SELECT last_success_at FROM job_rollup WHERE job = 'settlement_reconciliation') AS last_success_at,
  (SELECT last_failure_at FROM job_rollup WHERE job = 'settlement_reconciliation') AS last_failure_at,
  cr.oldest_open_at AS oldest_pending_at,
  CASE
    WHEN cr.high_count > 0 THEN 'Triage high-severity finance or listing exceptions first.'
    WHEN cr.open_count > 0 THEN 'Work through open cases or resolve with evidence where required.'
    ELSE 'No open reconciliation cases.'
  END AS recommendation
FROM case_rollup cr

UNION ALL

SELECT
  'withheld_payout_monitor',
  CASE WHEN wr.review_count > 0 THEN 'blocked' WHEN wr.open_count > 0 THEN 'warning' ELSE 'ready' END,
  CASE WHEN wr.review_count > 0 THEN 'high' WHEN wr.open_count > 0 THEN 'medium' ELSE 'low' END,
  wr.open_count,
  wr.review_count,
  0::BIGINT,
  0::BIGINT,
  (SELECT last_success_at FROM job_rollup WHERE job = 'settlement_reconciliation'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'settlement_reconciliation'),
  wr.oldest_open_at,
  CASE
    WHEN wr.review_count > 0 THEN 'Review withheld payout rows with mismatches or open reconciliation cases.'
    WHEN wr.open_count > 0 THEN 'Monitor marketplace/processor orders until payout evidence arrives.'
    ELSE 'No withheld payout rows need attention.'
  END
FROM withheld_rollup wr

UNION ALL

SELECT
  'qbo_posting_outbox',
  CASE WHEN qr.failed_count > 0 THEN 'blocked' WHEN qr.pending_count > 0 THEN 'warning' ELSE 'ready' END,
  CASE WHEN qr.failed_count > 0 THEN 'high' WHEN qr.pending_count > 0 THEN 'medium' ELSE 'low' END,
  0::BIGINT,
  qr.failed_count,
  qr.pending_count,
  0::BIGINT,
  (SELECT last_success_at FROM job_rollup WHERE job = 'qbo_posting_outbox'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'qbo_posting_outbox'),
  qr.oldest_pending_at,
  CASE
    WHEN qr.failed_count > 0 THEN 'Open failed QBO posting intents, fix the error, then retry or cancel with evidence.'
    WHEN qr.pending_count > 0 THEN 'Run the QBO posting outbox processor.'
    ELSE 'QBO posting outbox is clear.'
  END
FROM qbo_rollup qr

UNION ALL

SELECT
  'listing_command_outbox',
  CASE WHEN lr.failed_count > 0 THEN 'blocked' WHEN lr.pending_count > 0 THEN 'warning' ELSE 'ready' END,
  CASE WHEN lr.failed_count > 0 THEN 'high' WHEN lr.pending_count > 0 THEN 'medium' ELSE 'low' END,
  0::BIGINT,
  lr.failed_count,
  lr.pending_count,
  0::BIGINT,
  (SELECT last_success_at FROM job_rollup WHERE job = 'listing_outbox'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'listing_outbox'),
  lr.oldest_pending_at,
  CASE
    WHEN lr.failed_count > 0 THEN 'Open failed listing commands, correct listing/channel data, then retry or cancel.'
    WHEN lr.pending_count > 0 THEN 'Run the listing outbox processor.'
    ELSE 'Listing command outbox is clear.'
  END
FROM listing_rollup lr

UNION ALL

SELECT
  'blue_bell_accruals',
  CASE WHEN br.outstanding_amount > 0 THEN 'warning' ELSE 'ready' END,
  CASE WHEN br.outstanding_amount > 0 THEN 'medium' ELSE 'low' END,
  br.open_count,
  0::BIGINT,
  br.open_count,
  0::BIGINT,
  NULL::TIMESTAMPTZ,
  NULL::TIMESTAMPTZ,
  br.oldest_open_at,
  CASE
    WHEN br.outstanding_amount > 0 THEN 'Settle selected Blue Bell accruals from the rolling ledger.'
    ELSE 'No open Blue Bell accruals.'
  END
FROM blue_bell_rollup br

UNION ALL

SELECT
  'market_intelligence',
  CASE WHEN mr.snapshot_count = 0 OR mr.latest_snapshot_at < now() - interval '14 days' THEN 'warning' ELSE 'ready' END,
  CASE WHEN mr.snapshot_count = 0 OR mr.latest_snapshot_at < now() - interval '14 days' THEN 'medium' ELSE 'low' END,
  mr.stale_count,
  0::BIGINT,
  0::BIGINT,
  0::BIGINT,
  (SELECT last_success_at FROM job_rollup WHERE job = 'market_intelligence'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'market_intelligence'),
  mr.latest_snapshot_at,
  CASE
    WHEN mr.snapshot_count = 0 THEN 'Run market intelligence refresh before relying on pricing confidence.'
    WHEN mr.latest_snapshot_at < now() - interval '14 days' THEN 'Refresh stale market snapshots.'
    ELSE 'Market intelligence snapshots are fresh enough for normal pricing review.'
  END
FROM market_rollup mr

UNION ALL

SELECT
  'qbo_refresh_drift',
  CASE WHEN qr.open_count > 0 THEN 'warning' ELSE 'ready' END,
  CASE WHEN qr.open_count > 0 THEN 'medium' ELSE 'low' END,
  qr.open_count,
  0::BIGINT,
  0::BIGINT,
  0::BIGINT,
  qr.latest_run_at,
  NULL::TIMESTAMPTZ,
  qr.latest_run_at,
  CASE
    WHEN qr.open_count > 0 THEN 'Review QBO dry-run drift cases and approve reference updates only.'
    ELSE 'No open QBO refresh drift items.'
  END
FROM qbo_refresh_rollup qr

UNION ALL

SELECT
  'scheduled_automation',
  CASE WHEN sr.recent_failure_count > 0 THEN 'blocked' WHEN sr.last_success_at IS NULL THEN 'warning' ELSE 'ready' END,
  CASE WHEN sr.recent_failure_count > 0 THEN 'high' WHEN sr.last_success_at IS NULL THEN 'medium' ELSE 'low' END,
  sr.recent_failure_count,
  sr.recent_failure_count,
  0::BIGINT,
  0::BIGINT,
  sr.last_success_at,
  sr.last_failure_at,
  NULL::TIMESTAMPTZ,
  CASE
    WHEN sr.recent_failure_count > 0 THEN 'Review failed scheduled job runs and rerun the affected job.'
    WHEN sr.last_success_at IS NULL THEN 'Run the subledger scheduled jobs once to establish automation health.'
    ELSE 'Scheduled automation has recent successful evidence.'
  END
FROM scheduled_rollup sr;

GRANT SELECT ON public.v_entity_reference_columns TO authenticated;
GRANT SELECT ON public.v_rolling_settlement_monitor TO authenticated;
GRANT SELECT ON public.v_withheld_payout_monitor TO authenticated;
GRANT SELECT ON public.v_rolling_settlement_export TO authenticated;
GRANT SELECT ON public.v_blue_bell_accrual_ledger TO authenticated;
GRANT SELECT ON public.v_blue_bell_statement_export TO authenticated;
GRANT SELECT ON public.v_settlement_close_export TO authenticated;
GRANT SELECT ON public.v_blue_bell_monthly_statement_export TO authenticated;
GRANT SELECT ON public.v_posting_intent_with_references TO authenticated;
GRANT SELECT ON public.v_outbound_command_with_references TO authenticated;
GRANT SELECT ON public.v_reconciliation_inbox TO authenticated;
GRANT SELECT ON public.v_reconciliation_case_export TO authenticated;
GRANT SELECT ON public.v_margin_profit_report TO authenticated;
GRANT SELECT ON public.v_subledger_operations_health TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------
-- 5. QBO wholesale refresh dry-run foundation.
-- ------------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qbo_refresh_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'approved_apply')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_by UUID,
  requested_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qbo_refresh_drift (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_refresh_run_id UUID NOT NULL REFERENCES public.qbo_refresh_run(id) ON DELETE CASCADE,
  drift_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'applied', 'ignored')),
  qbo_entity_type TEXT NOT NULL,
  qbo_entity_id TEXT,
  qbo_doc_number TEXT,
  local_entity_type TEXT,
  local_entity_id UUID,
  local_reference TEXT,
  app_reference TEXT,
  target_route TEXT,
  current_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  qbo_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_action TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qbo_refresh_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_refresh_drift ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qbo_refresh_run_staff_all" ON public.qbo_refresh_run;
CREATE POLICY "qbo_refresh_run_staff_all" ON public.qbo_refresh_run
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

DROP POLICY IF EXISTS "qbo_refresh_drift_staff_all" ON public.qbo_refresh_drift;
CREATE POLICY "qbo_refresh_drift_staff_all" ON public.qbo_refresh_drift
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

DROP TRIGGER IF EXISTS set_qbo_refresh_run_updated_at ON public.qbo_refresh_run;
CREATE TRIGGER set_qbo_refresh_run_updated_at
  BEFORE UPDATE ON public.qbo_refresh_run
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_qbo_refresh_drift_run_status
  ON public.qbo_refresh_drift(qbo_refresh_run_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_qbo_refresh_drift_qbo_entity
  ON public.qbo_refresh_drift(qbo_entity_type, qbo_entity_id);
CREATE INDEX IF NOT EXISTS idx_qbo_refresh_drift_local_entity
  ON public.qbo_refresh_drift(local_entity_type, local_entity_id);

CREATE OR REPLACE FUNCTION public.rebuild_qbo_refresh_drift(p_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  DELETE FROM public.qbo_refresh_drift
  WHERE qbo_refresh_run_id = p_run_id;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id,
    local_entity_type, local_entity_id, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''local_qbo_item_missing_from_landing'',
    ''medium'',
    ''Item'',
    sk.qbo_item_id,
    ''sku'',
    sk.id,
    sk.id::TEXT,
    sk.sku_code,
    ''/admin/products'',
    jsonb_build_object(''sku_code'', sk.sku_code, ''qbo_item_id'', sk.qbo_item_id),
    ''{}''::jsonb,
    ''Run QBO item refresh. If the item was deleted or merged in QBO, approve a reference correction without changing website or eBay listing state.''
  FROM public.sku sk
  WHERE sk.qbo_item_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.landing_raw_qbo_item q
      WHERE q.external_id = sk.qbo_item_id
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id,
    local_entity_type, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''qbo_item_missing_local_reference'',
    ''medium'',
    ''Item'',
    q.external_id,
    ''sku'',
    q.raw_payload->>''Name'',
    q.raw_payload->>''Name'',
    ''/admin/settings'',
    ''{}''::jsonb,
    jsonb_build_object(''qbo_item_id'', q.external_id, ''name'', q.raw_payload->>''Name'', ''type'', q.raw_payload->>''Type''),
    ''Review whether this QBO item should map to an existing final graded SKU. Do not create placeholder SKUs just to satisfy QBO.''
  FROM public.landing_raw_qbo_item q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sku sk
    WHERE sk.qbo_item_id = q.external_id
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id, qbo_doc_number,
    local_entity_type, local_entity_id, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''local_qbo_sales_receipt_missing_from_landing'',
    ''medium'',
    ''SalesReceipt'',
    so.qbo_sales_receipt_id,
    so.doc_number,
    ''sales_order'',
    so.id,
    so.id::TEXT,
    so.order_number,
    ''/admin/orders/'' || so.id::TEXT,
    jsonb_build_object(''order_number'', so.order_number, ''qbo_sales_receipt_id'', so.qbo_sales_receipt_id, ''doc_number'', so.doc_number),
    ''{}''::jsonb,
    ''Run QBO sales refresh. If the QBO receipt changed, approve reference/doc-number updates only.''
  FROM public.sales_order so
  WHERE so.qbo_sales_receipt_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.landing_raw_qbo_sales_receipt q
      WHERE q.external_id = so.qbo_sales_receipt_id
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id, qbo_doc_number,
    local_entity_type, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''qbo_sales_receipt_missing_local_reference'',
    ''medium'',
    ''SalesReceipt'',
    q.external_id,
    q.raw_payload->>''DocNumber'',
    ''sales_order'',
    q.raw_payload->>''DocNumber'',
    q.raw_payload->>''DocNumber'',
    ''/admin/settings'',
    ''{}''::jsonb,
    jsonb_build_object(''qbo_sales_receipt_id'', q.external_id, ''doc_number'', q.raw_payload->>''DocNumber'', ''total'', q.raw_payload->>''TotalAmt''),
    ''Match this landed QBO receipt to an app order by app order number, origin reference, or known channel reference. Do not recreate listings.''
  FROM public.landing_raw_qbo_sales_receipt q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sales_order so
    WHERE so.qbo_sales_receipt_id = q.external_id
       OR so.doc_number = q.raw_payload->>''DocNumber''
       OR so.order_number = q.raw_payload->>''DocNumber''
       OR so.origin_reference = q.raw_payload->>''DocNumber''
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id, qbo_doc_number,
    local_entity_type, local_entity_id, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''local_qbo_purchase_missing_from_landing'',
    ''medium'',
    ''Purchase'',
    pb.qbo_purchase_id,
    pb.reference,
    ''purchase_batch'',
    pb.id,
    pb.id,
    ''/admin/purchases/'' || pb.id,
    jsonb_build_object(''batch_id'', pb.id, ''qbo_purchase_id'', pb.qbo_purchase_id, ''reference'', pb.reference),
    ''{}''::jsonb,
    ''Run QBO purchase refresh. If the QBO purchase was renumbered or merged, approve reference updates only after confirming stock is unchanged.''
  FROM public.purchase_batches pb
  WHERE pb.qbo_purchase_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.landing_raw_qbo_purchase q
      WHERE q.external_id = pb.qbo_purchase_id
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id, qbo_doc_number,
    local_entity_type, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''qbo_purchase_missing_local_reference'',
    ''medium'',
    ''Purchase'',
    q.external_id,
    q.raw_payload->>''DocNumber'',
    ''purchase_batch'',
    q.raw_payload->>''DocNumber'',
    q.raw_payload->>''DocNumber'',
    ''/admin/settings'',
    ''{}''::jsonb,
    jsonb_build_object(''qbo_purchase_id'', q.external_id, ''doc_number'', q.raw_payload->>''DocNumber'', ''total'', q.raw_payload->>''TotalAmt''),
    ''Review whether this QBO purchase maps to an app purchase batch or should remain QBO-only historical evidence.''
  FROM public.landing_raw_qbo_purchase q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.purchase_batches pb
    WHERE pb.qbo_purchase_id = q.external_id
       OR pb.reference = q.raw_payload->>''DocNumber''
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.inbound_receipt ir
    WHERE ir.qbo_purchase_id = q.external_id
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.qbo_refresh_drift (
    qbo_refresh_run_id, drift_type, severity, qbo_entity_type, qbo_entity_id,
    local_entity_type, local_entity_id, local_reference, app_reference, target_route,
    current_values, qbo_values, recommended_action
  )
  SELECT
    p_run_id,
    ''local_qbo_customer_missing_from_landing'',
    ''low'',
    ''Customer'',
    c.qbo_customer_id,
    ''customer'',
    c.id,
    c.id::TEXT,
    COALESCE(c.display_name, c.email, c.id::TEXT),
    ''/admin/customers/'' || c.id::TEXT,
    jsonb_build_object(''customer_id'', c.id, ''qbo_customer_id'', c.qbo_customer_id),
    ''{}''::jsonb,
    ''Run QBO customer refresh. If missing persists, verify whether the QBO customer was merged or deleted.''
  FROM public.customer c
  WHERE c.qbo_customer_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.landing_raw_qbo_customer q
      WHERE q.external_id = c.qbo_customer_id
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    evidence
  )
  SELECT
    ''qbo_refresh_drift'',
    d.severity,
    d.local_entity_type,
    d.local_entity_id,
    ''QBO wholesale dry-run detected drift: '' || d.drift_type,
    d.recommended_action,
    jsonb_build_object(
      ''qbo_refresh_run_id'', d.qbo_refresh_run_id,
      ''qbo_refresh_drift_id'', d.id,
      ''drift_type'', d.drift_type,
      ''qbo_entity_type'', d.qbo_entity_type,
      ''qbo_entity_id'', d.qbo_entity_id,
      ''qbo_doc_number'', d.qbo_doc_number,
      ''local_reference'', d.local_reference,
      ''app_reference'', d.app_reference,
      ''target_route'', d.target_route
    )
  FROM public.qbo_refresh_drift d
  WHERE d.qbo_refresh_run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''qbo_refresh_drift''
        AND rc.status IN (''open'', ''in_progress'')
        AND rc.evidence->>''qbo_refresh_drift_id'' = d.id::TEXT
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  UPDATE public.qbo_refresh_run
  SET result_summary = jsonb_build_object(
        ''drift_rows'', (SELECT COUNT(*) FROM public.qbo_refresh_drift WHERE qbo_refresh_run_id = p_run_id),
        ''reconciliation_cases_created'', v_rows
      ),
      updated_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.rebuild_qbo_refresh_drift(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_qbo_refresh_drift(
  p_drift_id UUID,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_drift public.qbo_refresh_drift%ROWTYPE;
BEGIN
  SELECT * INTO v_drift
  FROM public.qbo_refresh_drift
  WHERE id = p_drift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''qbo_refresh_drift % not found'', p_drift_id;
  END IF;

  IF v_drift.status NOT IN (''open'', ''ignored'') THEN
    RAISE EXCEPTION ''qbo_refresh_drift % cannot be approved from status %'', p_drift_id, v_drift.status;
  END IF;

  UPDATE public.qbo_refresh_drift
  SET status = ''approved'',
      approved_by = p_actor_id,
      approved_at = now()
  WHERE id = p_drift_id;

  RETURN jsonb_build_object(''success'', true, ''qbo_refresh_drift_id'', p_drift_id, ''status'', ''approved'');
END;
';

GRANT EXECUTE ON FUNCTION public.approve_qbo_refresh_drift(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_approved_qbo_refresh_drift(
  p_run_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_drift public.qbo_refresh_drift%ROWTYPE;
  v_applied INTEGER := 0;
  v_target_reference TEXT;
BEGIN
  FOR v_drift IN
    SELECT *
    FROM public.qbo_refresh_drift
    WHERE status = ''approved''
      AND (p_run_id IS NULL OR qbo_refresh_run_id = p_run_id)
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    v_target_reference := COALESCE(v_drift.local_reference, v_drift.app_reference);

    IF v_drift.local_entity_type = ''sku''
       AND v_drift.local_entity_id IS NOT NULL
       AND NULLIF(v_drift.qbo_entity_id, '''') IS NOT NULL THEN
      UPDATE public.sku
      SET qbo_item_id = v_drift.qbo_entity_id,
          updated_at = now()
      WHERE id = v_drift.local_entity_id;

    ELSIF v_drift.local_entity_type = ''sales_order''
       AND v_drift.local_entity_id IS NOT NULL THEN
      UPDATE public.sales_order
      SET qbo_sales_receipt_id = COALESCE(NULLIF(v_drift.qbo_entity_id, ''''), qbo_sales_receipt_id),
          doc_number = COALESCE(NULLIF(v_drift.qbo_doc_number, ''''), doc_number),
          updated_at = now()
      WHERE id = v_drift.local_entity_id;

    ELSIF v_drift.local_entity_type = ''purchase_batch''
       AND NULLIF(v_target_reference, '''') IS NOT NULL
       AND NULLIF(v_drift.qbo_entity_id, '''') IS NOT NULL THEN
      UPDATE public.purchase_batches
      SET qbo_purchase_id = v_drift.qbo_entity_id,
          qbo_sync_status = COALESCE(qbo_sync_status, ''pending''),
          updated_at = now()
      WHERE id = v_target_reference;

    ELSIF v_drift.local_entity_type = ''customer''
       AND v_drift.local_entity_id IS NOT NULL
       AND NULLIF(v_drift.qbo_entity_id, '''') IS NOT NULL THEN
      UPDATE public.customer
      SET qbo_customer_id = v_drift.qbo_entity_id
      WHERE id = v_drift.local_entity_id;

    ELSE
      CONTINUE;
    END IF;

    UPDATE public.qbo_refresh_drift
    SET status = ''applied'',
        applied_at = now()
    WHERE id = v_drift.id;

    INSERT INTO public.audit_event (
      entity_type,
      entity_id,
      trigger_type,
      actor_type,
      actor_id,
      source_system,
      input_json,
      output_json
    )
    VALUES (
      ''qbo_refresh_drift'',
      v_drift.id,
      ''qbo_refresh_drift_apply'',
      ''user'',
      p_actor_id,
      ''qbo'',
      to_jsonb(v_drift),
      jsonb_build_object(
        ''applied'', true,
        ''local_entity_type'', v_drift.local_entity_type,
        ''local_reference'', v_target_reference,
        ''qbo_entity_id'', v_drift.qbo_entity_id,
        ''qbo_doc_number'', v_drift.qbo_doc_number,
        ''preserved_listings'', true
      )
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN v_applied;
END;
';

GRANT EXECUTE ON FUNCTION public.apply_approved_qbo_refresh_drift(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_qbo_refresh_drift AS
SELECT
  d.*,
  r.mode AS refresh_mode,
  r.status AS refresh_status,
  r.started_at AS refresh_started_at,
  r.completed_at AS refresh_completed_at
FROM public.qbo_refresh_drift d
JOIN public.qbo_refresh_run r ON r.id = d.qbo_refresh_run_id
ORDER BY d.created_at DESC;

GRANT SELECT ON public.qbo_refresh_run TO authenticated;
GRANT SELECT ON public.qbo_refresh_drift TO authenticated;
GRANT SELECT ON public.v_qbo_refresh_drift TO authenticated;

COMMENT ON COLUMN public.reconciliation_case.owner_id IS
  'Deprecated compatibility field. Reconciliation cases are rolling operational exceptions, not assigned tasks.';
COMMENT ON COLUMN public.reconciliation_case.due_at IS
  'Deprecated compatibility field. Reconciliation cases are rolling operational exceptions; no SLA/due date model is used.';
COMMENT ON VIEW public.v_subledger_operations_health IS
  'Rolling operational health summary. This intentionally replaces period close and task SLA concepts.';
COMMENT ON VIEW public.v_settlement_close_export IS
  'Deprecated compatibility view name. Reads rolling settlement export data; no accounting period close workflow is implied.';
COMMENT ON VIEW public.v_blue_bell_monthly_statement_export IS
  'Deprecated compatibility view name. Reads rolling Blue Bell accrual statement data; date ranges are reporting filters, not accounting periods.';
COMMENT ON VIEW public.v_margin_profit_report IS
  'Rolling unit margin/profit export with normalized app, QBO, and channel references. No accounting period close workflow is implied.';