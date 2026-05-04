-- Expand reconciliation case generation to cover the exception types in the
-- commerce subledger plan. Lovable SQL runner note: single-quoted PL/pgSQL only.

CREATE INDEX IF NOT EXISTS idx_reconciliation_case_open_type_order
  ON public.reconciliation_case(case_type, sales_order_id, status)
  WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_reconciliation_case_open_related
  ON public.reconciliation_case(case_type, related_entity_type, related_entity_id, status)
  WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_payout_fee_unmatched
  ON public.payout_fee(created_at, external_order_id)
  WHERE sales_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_posting_intent_qbo_failed
  ON public.posting_intent(entity_type, entity_id, created_at)
  WHERE target_system = 'qbo' AND status = 'failed';

CREATE OR REPLACE FUNCTION public.rebuild_reconciliation_cases(p_sales_order_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_count INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
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
  SELECT
    ''unallocated_order_line'',
    ''high'',
    sol.sales_order_id,
    sol.id,
    ''sales_order_line'',
    sol.id,
    ''Sale line has not been allocated to a stock unit.'',
    ''Allocate stock through the costing subledger or approve a manual allocation exception.'',
    jsonb_build_object(
      ''sku_id'', sol.sku_id,
      ''quantity'', sol.quantity,
      ''economics_status'', sol.economics_status
    )
  FROM public.sales_order_line sol
  WHERE (p_sales_order_id IS NULL OR sol.sales_order_id = p_sales_order_id)
    AND sol.stock_unit_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''unallocated_order_line''
        AND rc.sales_order_line_id = sol.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

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
  SELECT
    ''missing_cogs'',
    ''high'',
    sol.sales_order_id,
    sol.id,
    ''sales_order_line'',
    sol.id,
    ''Sale line has no finalized COGS.'',
    ''Allocate stock or approve a manual costing exception before final accounting close.'',
    jsonb_build_object(
      ''sku_id'', sol.sku_id,
      ''stock_unit_id'', sol.stock_unit_id,
      ''costing_method'', sol.costing_method,
      ''economics_status'', sol.economics_status
    )
  FROM public.sales_order_line sol
  WHERE (p_sales_order_id IS NULL OR sol.sales_order_id = p_sales_order_id)
    AND sol.stock_unit_id IS NOT NULL
    AND (
      sol.cogs_amount IS NULL
      OR sol.cogs_amount = 0
      OR sol.economics_status IN (''needs_allocation'', ''incomplete'')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''missing_cogs''
        AND rc.sales_order_line_id = sol.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    amount_expected,
    evidence
  )
  SELECT
    ''unmatched_payout_fee'',
    ''medium'',
    ''payout_fee'',
    pf.id,
    ''Payout fee has no matched local sales order.'',
    ''Late-match by external order ID or classify it as a platform-level fee allocation.'',
    pf.amount,
    jsonb_build_object(
      ''payout_id'', pf.payout_id,
      ''external_order_id'', pf.external_order_id,
      ''channel'', pf.channel,
      ''fee_category'', pf.fee_category
    )
  FROM public.payout_fee pf
  WHERE p_sales_order_id IS NULL
    AND pf.sales_order_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''unmatched_payout_fee''
        AND rc.related_entity_type = ''payout_fee''
        AND rc.related_entity_id = pf.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    suspected_root_cause,
    recommended_action,
    amount_expected,
    amount_actual,
    variance_amount,
    evidence
  )
  WITH expected AS (
    SELECT sales_order_id, ROUND(SUM(amount), 2) AS expected_amount
    FROM public.expected_settlement_line
    WHERE sales_order_id IS NOT NULL
      AND (p_sales_order_id IS NULL OR sales_order_id = p_sales_order_id)
    GROUP BY sales_order_id
  ),
  actual AS (
    SELECT sales_order_id, ROUND(SUM(amount), 2) AS actual_amount
    FROM public.actual_settlement_line
    WHERE sales_order_id IS NOT NULL
      AND (p_sales_order_id IS NULL OR sales_order_id = p_sales_order_id)
    GROUP BY sales_order_id
  )
  SELECT
    ''amount_mismatch'',
    CASE WHEN ABS(e.expected_amount - COALESCE(a.actual_amount, 0)) > 5 THEN ''high'' ELSE ''medium'' END,
    e.sales_order_id,
    ''Expected and actual settlement amounts differ outside tolerance.'',
    ''Review payout, fee, refund, and QBO posting evidence.'',
    e.expected_amount,
    COALESCE(a.actual_amount, 0),
    e.expected_amount - COALESCE(a.actual_amount, 0),
    jsonb_build_object(''expected'', e.expected_amount, ''actual'', COALESCE(a.actual_amount, 0))
  FROM expected e
  LEFT JOIN actual a ON a.sales_order_id = e.sales_order_id
  WHERE ABS(e.expected_amount - COALESCE(a.actual_amount, 0)) > 0.05
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''amount_mismatch''
        AND rc.sales_order_id = e.sales_order_id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    suspected_root_cause,
    recommended_action,
    amount_expected,
    amount_actual,
    variance_amount,
    due_at,
    evidence
  )
  WITH expected AS (
    SELECT esl.sales_order_id, ROUND(SUM(esl.amount), 2) AS expected_amount
    FROM public.expected_settlement_line esl
    JOIN public.sales_order so ON so.id = esl.sales_order_id
    WHERE (p_sales_order_id IS NULL OR esl.sales_order_id = p_sales_order_id)
      AND so.created_at < now() - interval ''7 days''
      AND COALESCE(so.origin_channel, '''') NOT IN (''in_person'', ''cash'', ''qbo'', ''qbo_refund'')
    GROUP BY esl.sales_order_id
  )
  SELECT
    ''missing_payout'',
    ''medium'',
    e.sales_order_id,
    ''No actual settlement evidence has been linked beyond the payout SLA.'',
    ''Import or reconcile the channel payout, then refresh settlement lines.'',
    e.expected_amount,
    0,
    e.expected_amount,
    so.created_at + interval ''7 days'',
    jsonb_build_object(
      ''origin_channel'', so.origin_channel,
      ''order_number'', so.order_number,
      ''order_created_at'', so.created_at
    )
  FROM expected e
  JOIN public.sales_order so ON so.id = e.sales_order_id
  WHERE NOT EXISTS (
      SELECT 1
      FROM public.actual_settlement_line asl
      WHERE asl.sales_order_id = e.sales_order_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''missing_payout''
        AND rc.sales_order_id = e.sales_order_id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    amount_expected,
    evidence
  )
  SELECT
    ''unpaid_program_accrual'',
    ''medium'',
    spa.sales_order_id,
    ''sales_program_accrual'',
    spa.id,
    ''Program commission accrual is open and not attached to a settlement.'',
    ''Include this accrual in the next sales-program settlement run.'',
    spa.commission_amount - spa.reversed_amount,
    jsonb_build_object(
      ''sales_program_id'', spa.sales_program_id,
      ''status'', spa.status,
      ''currency'', spa.currency
    )
  FROM public.sales_program_accrual spa
  WHERE (p_sales_order_id IS NULL OR spa.sales_order_id = p_sales_order_id)
    AND spa.status IN (''open'', ''partially_settled'')
    AND spa.settlement_id IS NULL
    AND spa.commission_amount - spa.reversed_amount > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''unpaid_program_accrual''
        AND rc.related_entity_type = ''sales_program_accrual''
        AND rc.related_entity_id = spa.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    evidence
  )
  SELECT
    ''qbo_posting_gap'',
    ''high'',
    pi.entity_id,
    ''posting_intent'',
    pi.id,
    ''QBO posting intent failed.'',
    ''Review the posting error, fix the source data or QBO mapping, then retry the outbox processor.'',
    jsonb_build_object(
      ''action'', pi.action,
      ''retry_count'', pi.retry_count,
      ''last_error'', pi.last_error,
      ''idempotency_key'', pi.idempotency_key
    )
  FROM public.posting_intent pi
  WHERE pi.target_system = ''qbo''
    AND pi.status = ''failed''
    AND pi.entity_type = ''sales_order''
    AND (p_sales_order_id IS NULL OR pi.entity_id = p_sales_order_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''qbo_posting_gap''
        AND rc.related_entity_type = ''posting_intent''
        AND rc.related_entity_id = pi.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    sales_order_id,
    related_entity_type,
    related_entity_id,
    suspected_root_cause,
    recommended_action,
    due_at,
    evidence
  )
  SELECT
    ''qbo_posting_gap'',
    ''medium'',
    so.id,
    ''sales_order'',
    so.id,
    ''Order has app-side accounting events but no QBO posting intent or posting reference.'',
    ''Queue QBO posting intents for the order, or mark the order as intentionally excluded with evidence.'',
    so.created_at + interval ''1 day'',
    jsonb_build_object(
      ''order_number'', so.order_number,
      ''origin_channel'', so.origin_channel,
      ''accounting_event_count'', COUNT(ae.id)
    )
  FROM public.sales_order so
  JOIN public.accounting_event ae ON ae.sales_order_id = so.id
  WHERE (p_sales_order_id IS NULL OR so.id = p_sales_order_id)
    AND so.created_at < now() - interval ''1 day''
    AND COALESCE(so.origin_channel, '''') NOT IN (''qbo'', ''qbo_refund'')
    AND NOT EXISTS (
      SELECT 1
      FROM public.posting_intent pi
      WHERE pi.target_system = ''qbo''
        AND pi.entity_type = ''sales_order''
        AND pi.entity_id = so.id
        AND pi.status IN (''pending'', ''processing'', ''posted'', ''failed'')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.qbo_posting_reference qpr
      WHERE qpr.local_entity_type = ''sales_order''
        AND qpr.local_entity_id = so.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_case rc
      WHERE rc.case_type = ''qbo_posting_gap''
        AND rc.sales_order_id = so.id
        AND rc.related_entity_type = ''sales_order''
        AND rc.status IN (''open'', ''in_progress'')
    )
  GROUP BY so.id, so.order_number, so.origin_channel, so.created_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  INSERT INTO public.reconciliation_case (
    case_type,
    severity,
    related_entity_type,
    suspected_root_cause,
    recommended_action,
    amount_actual,
    evidence
  )
  WITH duplicates AS (
    SELECT
      source_system,
      external_reference,
      category,
      ROUND(SUM(amount), 2) AS total_amount,
      COUNT(*) AS duplicate_count,
      MIN(created_at) AS first_seen
    FROM public.actual_settlement_line
    WHERE p_sales_order_id IS NULL
      AND external_reference IS NOT NULL
    GROUP BY source_system, external_reference, category
    HAVING COUNT(*) > 1
  )
  SELECT
    ''duplicate_candidate'',
    ''medium'',
    ''actual_settlement_line'',
    ''Multiple actual settlement lines share the same external reference and category.'',
    ''Review payout import idempotency and remove or merge duplicate settlement evidence.'',
    d.total_amount,
    jsonb_build_object(
      ''source_system'', d.source_system,
      ''external_reference'', d.external_reference,
      ''category'', d.category,
      ''duplicate_count'', d.duplicate_count,
      ''first_seen'', d.first_seen
    )
  FROM duplicates d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.reconciliation_case rc
    WHERE rc.case_type = ''duplicate_candidate''
      AND rc.related_entity_type = ''actual_settlement_line''
      AND rc.status IN (''open'', ''in_progress'')
      AND rc.evidence->>''source_system'' = d.source_system
      AND rc.evidence->>''external_reference'' = d.external_reference
      AND rc.evidence->>''category'' = d.category
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.rebuild_reconciliation_cases(UUID)
TO authenticated, service_role;
