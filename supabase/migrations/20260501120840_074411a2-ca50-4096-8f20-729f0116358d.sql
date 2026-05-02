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