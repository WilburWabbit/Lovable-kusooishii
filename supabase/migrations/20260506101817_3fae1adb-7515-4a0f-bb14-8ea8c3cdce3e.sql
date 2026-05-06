DROP VIEW IF EXISTS public.v_operations_issue_inbox;

CREATE OR REPLACE VIEW public.v_operations_issue_inbox
WITH (security_invoker = true)
AS
WITH available_stock AS (
  SELECT
    su.sku_id,
    COUNT(*)::INTEGER AS available_quantity,
    jsonb_agg(su.id ORDER BY su.created_at) FILTER (WHERE su.id IS NOT NULL) AS stock_unit_ids
  FROM public.stock_unit su
  WHERE su.order_id IS NULL
    AND su.line_item_id IS NULL
    AND COALESCE(su.v2_status::text, su.status::text) IN ('graded', 'listed', 'restocked', 'received', 'available')
  GROUP BY su.sku_id
),
raw_issues AS (
  SELECT
    'reconciliation:' || inbox.id::text AS id,
    'reconciliation:' || inbox.id::text AS issue_key,
    CASE
      WHEN inbox.case_type IN ('missing_cogs', 'unallocated_order_line') THEN 'inventory'
      WHEN inbox.case_type IN ('qbo_posting_gap', 'duplicate_candidate', 'unmatched_payout_fee', 'missing_payout', 'amount_mismatch') THEN 'transactions'
      WHEN inbox.case_type = 'listing_command_failed' THEN 'integrations'
      ELSE 'integrations'
    END AS domain,
    CASE
      WHEN inbox.case_type = 'missing_cogs' THEN 'order_line_missing_stock_allocation'
      WHEN inbox.case_type = 'unallocated_order_line' THEN 'order_line_missing_stock_allocation'
      WHEN inbox.case_type = 'qbo_posting_gap' THEN 'app_sales_receipt_missing_qbo'
      WHEN inbox.case_type = 'duplicate_candidate' THEN 'ambiguous_transaction_match'
      WHEN inbox.case_type = 'unmatched_payout_fee' THEN 'ambiguous_transaction_match'
      WHEN inbox.case_type = 'missing_payout' THEN 'app_sales_receipt_missing_qbo'
      WHEN inbox.case_type = 'amount_mismatch' THEN 'ambiguous_transaction_match'
      WHEN inbox.case_type = 'listing_command_failed' THEN 'outbox_failed_after_retries'
      ELSE 'integration_auth_or_config_failure'
    END AS issue_type,
    inbox.severity,
    inbox.status,
    CASE
      WHEN inbox.case_type IN ('missing_cogs', 'unallocated_order_line', 'qbo_posting_gap') THEN 0.95
      WHEN inbox.case_type IN ('duplicate_candidate', 'unmatched_payout_fee', 'amount_mismatch') THEN 0.72
      ELSE 0.80
    END::NUMERIC(4,2) AS confidence,
    CASE
      WHEN inbox.case_type = 'listing_command_failed' THEN 'channel'
      WHEN inbox.case_type = 'qbo_posting_gap' THEN 'app'
      ELSE 'reconciliation'
    END AS source_system,
    'reconciliation_case' AS source_table,
    inbox.id::text AS source_id,
    COALESCE(
      CASE WHEN inbox.sales_order_id IS NOT NULL THEN 'sales_order' END,
      CASE WHEN inbox.sales_order_line_id IS NOT NULL THEN 'sales_order_line' END,
      inbox.related_entity_type,
      'reconciliation_case'
    ) AS primary_entity_type,
    COALESCE(inbox.sales_order_id::text, inbox.sales_order_line_id::text, inbox.related_entity_id::text, inbox.id::text) AS primary_entity_id,
    COALESCE(inbox.order_number, inbox.app_reference, inbox.target_label, inbox.id::text) AS primary_reference,
    COALESCE(inbox.qbo_doc_number, inbox.external_reference, inbox.ebay_reference, inbox.stripe_reference) AS secondary_reference,
    CASE
      WHEN inbox.case_type IN ('missing_cogs', 'unallocated_order_line') THEN 'Order line needs stock allocation'
      WHEN inbox.case_type = 'qbo_posting_gap' THEN 'Sales receipt is missing from QBO'
      WHEN inbox.case_type IN ('duplicate_candidate', 'unmatched_payout_fee', 'amount_mismatch') THEN 'Transaction match needs review'
      WHEN inbox.case_type = 'missing_payout' THEN 'Payout evidence is missing'
      WHEN inbox.case_type = 'listing_command_failed' THEN 'Integration command failed'
      ELSE COALESCE(inbox.target_label, 'Operational issue needs review')
    END AS title,
    COALESCE(inbox.diagnosis, inbox.suspected_root_cause, 'This issue can block correct accounting, fulfilment, or channel operations.') AS why_it_matters,
    jsonb_build_object(
      'source', 'reconciliation_case',
      'case_type', inbox.case_type,
      'status', inbox.status,
      'app_reference', inbox.app_reference,
      'qbo_entity_id', inbox.qbo_entity_id,
      'qbo_doc_number', inbox.qbo_doc_number,
      'external_reference', inbox.external_reference,
      'amount_expected', inbox.amount_expected,
      'amount_actual', inbox.amount_actual,
      'variance_amount', inbox.variance_amount,
      'raw', inbox.evidence
    ) AS evidence,
    COALESCE(inbox.next_step, inbox.recommended_action, 'Open the affected record, review the evidence, then resolve or dismiss with a note.') AS recommended_action,
    CASE
      WHEN inbox.case_type IN ('missing_cogs', 'unallocated_order_line') THEN 'allocate_stock'
      WHEN inbox.case_type = 'qbo_posting_gap' THEN 'queue_qbo_posting'
      WHEN inbox.case_type = 'listing_command_failed' THEN 'retry_integration'
      WHEN inbox.case_type IN ('duplicate_candidate', 'unmatched_payout_fee', 'amount_mismatch') THEN 'review_duplicate'
      WHEN inbox.case_type = 'missing_payout' THEN 'refresh_settlement'
      ELSE 'start_work'
    END AS primary_action,
    CASE
      WHEN inbox.case_type = 'listing_command_failed' THEN jsonb_build_array('retry_integration', 'cancel_integration', 'dismiss')
      WHEN inbox.case_type = 'qbo_posting_gap' THEN jsonb_build_array('queue_qbo_posting', 'start_work', 'dismiss')
      ELSE jsonb_build_array('start_work', 'dismiss')
    END AS secondary_actions,
    inbox.target_route,
    inbox.target_label,
    inbox.amount_expected,
    inbox.amount_actual,
    inbox.variance_amount,
    inbox.created_at,
    inbox.updated_at,
    CASE inbox.severity
      WHEN 'critical' THEN 10
      WHEN 'high' THEN 20
      WHEN 'medium' THEN 40
      ELSE 60
    END AS sort_rank
  FROM public.v_reconciliation_inbox inbox
  WHERE inbox.case_type NOT IN ('unpaid_program_accrual')

  UNION ALL

  SELECT
    'sales_order:missing_qbo:' || so.id::text,
    'sales_order:missing_qbo:' || so.id::text,
    'transactions',
    'app_sales_receipt_missing_qbo',
    'high',
    'open',
    0.98::NUMERIC(4,2),
    'app',
    'sales_order',
    so.id::text,
    'sales_order',
    so.id::text,
    so.order_number,
    COALESCE(so.origin_reference, so.payment_reference),
    'App sale has not posted to QBO',
    'The order is active/recent in the app but there is no QBO sales receipt id, posting reference, or queued posting intent.',
    jsonb_build_object('app', jsonb_build_object('sales_order_id', so.id, 'order_number', so.order_number, 'origin_channel', so.origin_channel, 'gross_total', so.gross_total, 'qbo_sales_receipt_id', so.qbo_sales_receipt_id, 'qbo_sync_status', so.qbo_sync_status), 'qbo', jsonb_build_object('posting_reference', NULL)),
    'Queue the QBO sales receipt posting after confirming the customer mapping is correct.',
    'queue_qbo_posting',
    jsonb_build_array('queue_qbo_posting', 'fix_customer_mapping', 'dismiss'),
    '/admin/orders/' || so.id::text,
    so.order_number,
    so.gross_total,
    NULL::NUMERIC,
    so.gross_total,
    so.created_at,
    so.updated_at,
    15
  FROM public.sales_order so
  WHERE so.created_at >= now() - INTERVAL '18 months'
    AND COALESCE(so.is_test, false) IS FALSE
    AND so.status::text NOT IN ('pending_payment', 'authorised', 'cancelled', 'refunded')
    AND so.qbo_sales_receipt_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.qbo_posting_reference ref
      WHERE ref.local_entity_type = 'sales_order'
        AND ref.local_entity_id = so.id
        AND ref.qbo_entity_type IN ('sales_receipt', 'SalesReceipt')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.posting_intent pi
      WHERE pi.target_system = 'qbo'
        AND pi.action = 'create_sales_receipt'
        AND pi.entity_type = 'sales_order'
        AND pi.entity_id = so.id
        AND pi.status IN ('pending', 'processing')
    )

  UNION ALL

  SELECT
    'qbo_sales_receipt:missing_app:' || raw.id::text,
    'qbo_sales_receipt:missing_app:' || raw.id::text,
    'transactions',
    'qbo_sales_receipt_missing_app',
    'high',
    'open',
    0.86::NUMERIC(4,2),
    'qbo',
    'landing_raw_qbo_sales_receipt',
    raw.id::text,
    'qbo_sales_receipt',
    raw.id::text,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    'QBO sales receipt is not linked to an app sale',
    'QBO has a recent sales receipt landing record that does not match any app order by QBO id, document number, or known external references.',
    jsonb_build_object('qbo', jsonb_build_object('landing_id', raw.id, 'external_id', raw.external_id, 'doc_number', raw.raw_payload->>'DocNumber', 'total_amount', raw.raw_payload->>'TotalAmt', 'status', raw.status), 'app_match', NULL),
    'Review the QBO landing record and either link it to the correct app sale or import/create the missing sale.',
    'review_qbo_landing',
    jsonb_build_array('review_qbo_landing', 'link_transaction', 'dismiss'),
    '/admin/settings/app-health',
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    NULL::NUMERIC,
    CASE WHEN COALESCE(raw.raw_payload->>'TotalAmt', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (raw.raw_payload->>'TotalAmt')::NUMERIC ELSE NULL::NUMERIC END,
    NULL::NUMERIC,
    raw.received_at,
    COALESCE(raw.processed_at, raw.received_at),
    20
  FROM public.landing_raw_qbo_sales_receipt raw
  WHERE raw.received_at >= now() - INTERVAL '18 months'
    AND raw.status NOT IN ('error', 'skipped')
    AND NOT EXISTS (
      SELECT 1 FROM public.sales_order so
      WHERE so.qbo_sales_receipt_id = raw.external_id
         OR NULLIF(so.doc_number, '') = NULLIF(raw.raw_payload->>'DocNumber', '')
         OR NULLIF(so.origin_reference, '') = NULLIF(raw.raw_payload->>'DocNumber', '')
         OR NULLIF(so.order_number, '') = NULLIF(raw.raw_payload->>'DocNumber', '')
    )

  UNION ALL

  SELECT
    'purchase_batch:missing_qbo:' || pb.id::text,
    'purchase_batch:missing_qbo:' || pb.id::text,
    'transactions',
    'app_purchase_missing_qbo',
    'medium',
    'open',
    0.96::NUMERIC(4,2),
    'app',
    'purchase_batches',
    pb.id::text,
    'purchase_batch',
    pb.id::text,
    COALESCE(pb.reference, pb.id::text),
    pb.supplier_name,
    'App purchase has not posted to QBO',
    'The purchase batch is recorded in the app, but there is no QBO purchase id, posting reference, or queued purchase posting intent.',
    jsonb_build_object('app', jsonb_build_object('purchase_batch_id', pb.id, 'reference', pb.reference, 'supplier_name', pb.supplier_name, 'qbo_purchase_id', pb.qbo_purchase_id, 'qbo_sync_status', pb.qbo_sync_status), 'qbo', jsonb_build_object('posting_reference', NULL)),
    'Queue the QBO purchase posting after confirming the batch has complete grading and product data.',
    'queue_qbo_posting',
    jsonb_build_array('queue_qbo_posting', 'fix_product_specs', 'dismiss'),
    '/admin/purchases/' || pb.id::text,
    COALESCE(pb.reference, pb.supplier_name),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    pb.created_at,
    pb.updated_at,
    35
  FROM public.purchase_batches pb
  WHERE pb.purchase_date >= (CURRENT_DATE - INTERVAL '18 months')
    AND pb.status::text = 'recorded'
    AND pb.qbo_purchase_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.qbo_posting_reference ref
      WHERE ref.local_entity_type IN ('purchase_batch', 'purchase')
        AND ref.local_entity_id::text = pb.id
        AND ref.qbo_entity_type IN ('purchase', 'Purchase')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.posting_intent pi
      WHERE pi.target_system = 'qbo'
        AND pi.action IN ('create_purchase', 'update_purchase')
        AND pi.entity_type = 'purchase_batch'
        AND COALESCE(pi.payload->>'batch_id', pi.payload->>'purchase_batch_id') = pb.id
        AND pi.status IN ('pending', 'processing')
    )

  UNION ALL

  SELECT
    'qbo_purchase:missing_app:' || raw.id::text,
    'qbo_purchase:missing_app:' || raw.id::text,
    'transactions',
    'qbo_purchase_missing_app',
    'medium',
    'open',
    0.84::NUMERIC(4,2),
    'qbo',
    'landing_raw_qbo_purchase',
    raw.id::text,
    'qbo_purchase',
    raw.id::text,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    'QBO purchase is not linked to an app purchase',
    'QBO has a recent purchase landing record that does not match a recorded app purchase by QBO id or reference.',
    jsonb_build_object('qbo', jsonb_build_object('landing_id', raw.id, 'external_id', raw.external_id, 'doc_number', raw.raw_payload->>'DocNumber'), 'app_match', NULL),
    'Review the QBO landing record and link it to the correct app purchase or create the missing batch.',
    'review_qbo_landing',
    jsonb_build_array('review_qbo_landing', 'link_transaction', 'dismiss'),
    '/admin/settings/app-health',
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    NULL::NUMERIC,
    CASE WHEN COALESCE(raw.raw_payload->>'TotalAmt', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (raw.raw_payload->>'TotalAmt')::NUMERIC ELSE NULL::NUMERIC END,
    NULL::NUMERIC,
    raw.received_at,
    COALESCE(raw.processed_at, raw.received_at),
    45
  FROM public.landing_raw_qbo_purchase raw
  WHERE raw.received_at >= now() - INTERVAL '18 months'
    AND raw.status NOT IN ('error', 'skipped')
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_batches pb
      WHERE pb.qbo_purchase_id = raw.external_id
         OR NULLIF(pb.reference, '') = NULLIF(raw.raw_payload->>'DocNumber', '')
    )

  UNION ALL

  SELECT
    'sales_order_line:allocation:' || sol.id::text,
    'sales_order_line:allocation:' || sol.id::text,
    'inventory',
    'order_line_missing_stock_allocation',
    'high',
    'open',
    0.98::NUMERIC(4,2),
    'app',
    'sales_order_line',
    sol.id::text,
    'sales_order',
    so.id::text,
    so.order_number,
    sk.sku_code,
    'Order line has no stock allocation',
    'The order cannot have final COGS, margin, or reliable fulfilment until a specific stock unit is allocated.',
    jsonb_build_object('order', jsonb_build_object('sales_order_id', so.id, 'order_number', so.order_number), 'line', jsonb_build_object('sales_order_line_id', sol.id, 'sku_code', sk.sku_code, 'quantity', sol.quantity), 'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0), 'candidate_stock_units', COALESCE(av.stock_unit_ids, '[]'::jsonb))),
    'Allocate a saleable stock unit to this order line, or record a deliberate manual exception if stock does not exist.',
    'allocate_stock',
    jsonb_build_array('allocate_stock', 'dismiss'),
    '/admin/orders/' || so.id::text,
    so.order_number,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    sol.created_at,
    so.updated_at,
    25
  FROM public.sales_order_line sol
  JOIN public.sales_order so ON so.id = sol.sales_order_id
  LEFT JOIN public.sku sk ON sk.id = sol.sku_id
  LEFT JOIN available_stock av ON av.sku_id = sol.sku_id
  WHERE sol.stock_unit_id IS NULL
    AND so.status::text IN ('paid', 'picking', 'packed', 'awaiting_dispatch', 'shipped', 'complete', 'exception')
    AND COALESCE(so.v2_status::text, '') NOT IN ('cancelled', 'refunded')
    AND so.created_at >= now() - INTERVAL '18 months'

  UNION ALL

  SELECT
    'channel_listing:out_of_stock:' || cl.id::text,
    'channel_listing:out_of_stock:' || cl.id::text,
    'inventory',
    'listed_sku_out_of_stock',
    'high',
    'open',
    0.96::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id::text,
    'channel_listing',
    cl.id::text,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Out-of-stock SKU is listed for sale',
    'The channel listing appears live or quantity-bearing, but no available stock units exist for the SKU.',
    jsonb_build_object('listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'listed_quantity', cl.listed_quantity), 'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0))),
    'Pause the listing or sync the channel quantity to zero before another order can be placed.',
    'pause_listing',
    jsonb_build_array('pause_listing', 'sync_listing_quantity', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    COALESCE(cl.listed_quantity, 0)::NUMERIC,
    COALESCE(av.available_quantity, 0)::NUMERIC,
    COALESCE(cl.listed_quantity, 0)::NUMERIC - COALESCE(av.available_quantity, 0)::NUMERIC,
    cl.created_at,
    cl.updated_at,
    18
  FROM public.channel_listing cl
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  LEFT JOIN available_stock av ON av.sku_id = cl.sku_id
  WHERE COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('live', 'ACTIVE', 'active')
    AND COALESCE(av.available_quantity, 0) = 0
    AND COALESCE(cl.listed_quantity, 1) > 0
    AND cl.availability_override IS NULL

  UNION ALL

  SELECT
    'posting_intent:failed:' || pi.id::text,
    'posting_intent:failed:' || pi.id::text,
    'integrations',
    'outbox_failed_after_retries',
    CASE WHEN pi.retry_count >= 3 THEN 'high' ELSE 'medium' END,
    'open',
    0.95::NUMERIC(4,2),
    'qbo',
    'posting_intent',
    pi.id::text,
    pi.entity_type,
    pi.entity_id::text,
    COALESCE(pi.payload->>'order_number', pi.payload->>'reference', pi.payload->>'batch_id', pi.id::text),
    pi.action,
    'QBO posting failed',
    'A QBO posting intent has failed or exhausted retries. The failed item should show the source record, error, and retry path.',
    jsonb_build_object('posting_intent', jsonb_build_object('id', pi.id, 'action', pi.action, 'entity_type', pi.entity_type, 'entity_id', pi.entity_id, 'status', pi.status, 'last_error', pi.last_error)),
    'Fix the source data named in the error, then retry the QBO posting intent.',
    'retry_integration',
    jsonb_build_array('retry_integration', 'cancel_integration', 'dismiss'),
    CASE
      WHEN pi.entity_type = 'sales_order' AND pi.entity_id IS NOT NULL THEN '/admin/orders/' || pi.entity_id::text
      WHEN pi.entity_type = 'purchase_batch' THEN '/admin/purchases/' || COALESCE(pi.payload->>'batch_id', pi.payload->>'purchase_batch_id', '')
      ELSE '/admin/operations'
    END,
    COALESCE(pi.payload->>'order_number', pi.payload->>'reference', pi.payload->>'batch_id', pi.id::text),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    pi.created_at,
    pi.updated_at,
    28
  FROM public.posting_intent pi
  WHERE pi.target_system = 'qbo'
    AND (pi.status = 'failed' OR (pi.status IN ('pending', 'processing') AND pi.created_at < now() - INTERVAL '24 hours'))

  UNION ALL

  SELECT
    'outbound_command:failed:' || cmd.id::text,
    'outbound_command:failed:' || cmd.id::text,
    'integrations',
    CASE WHEN cmd.last_error ILIKE '%valid%' THEN 'third_party_validation_error' ELSE 'outbox_failed_after_retries' END,
    CASE WHEN cmd.retry_count >= 3 THEN 'high' ELSE 'medium' END,
    'open',
    0.94::NUMERIC(4,2),
    cmd.target_system,
    'outbound_command',
    cmd.id::text,
    cmd.entity_type,
    cmd.entity_id::text,
    COALESCE(cl.external_sku, sk.sku_code, cmd.id::text),
    cmd.command_type,
    'Channel command failed',
    'A third-party listing/channel command failed or stalled and needs a concrete retry, cancellation, or source-data fix.',
    jsonb_build_object('outbound_command', jsonb_build_object('id', cmd.id, 'target_system', cmd.target_system, 'command_type', cmd.command_type, 'status', cmd.status, 'last_error', cmd.last_error)),
    'Fix the source listing data or channel validation error, then retry the command.',
    'retry_integration',
    jsonb_build_array('retry_integration', 'cancel_integration', 'fix_listing_data', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cmd.id::text),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    cmd.created_at,
    cmd.updated_at,
    30
  FROM public.outbound_command cmd
  LEFT JOIN public.channel_listing cl ON cl.id = cmd.entity_id
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  WHERE cmd.entity_type = 'channel_listing'
    AND (cmd.status = 'failed' OR (cmd.status IN ('pending', 'processing') AND cmd.created_at < now() - INTERVAL '24 hours'))
)
SELECT
  ri.id,
  ri.issue_key,
  ri.domain,
  ri.issue_type,
  ri.severity,
  ri.status,
  ri.confidence,
  ri.source_system,
  ri.source_table,
  ri.source_id,
  ri.primary_entity_type,
  ri.primary_entity_id,
  ri.primary_reference,
  ri.secondary_reference,
  ri.title,
  ri.why_it_matters,
  ri.evidence,
  ri.recommended_action,
  ri.primary_action,
  ri.secondary_actions,
  ri.target_route,
  ri.target_label,
  ri.amount_expected,
  ri.amount_actual,
  ri.variance_amount,
  ri.created_at,
  ri.updated_at,
  ri.sort_rank
FROM raw_issues ri
WHERE NOT EXISTS (
  SELECT 1 FROM public.operations_issue_suppression s
  WHERE s.issue_key = ri.issue_key
    AND s.status IN ('dismissed', 'resolved', 'suppressed')
    AND (s.expires_at IS NULL OR s.expires_at > now())
)
ORDER BY ri.sort_rank ASC, ri.created_at ASC;

GRANT SELECT ON public.v_operations_issue_inbox TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_operations_issue(
  p_issue_id TEXT,
  p_action TEXT DEFAULT 'dismiss',
  p_note TEXT DEFAULT NULL,
  p_evidence JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_issue public.v_operations_issue_inbox%ROWTYPE;
  v_action TEXT;
  v_note TEXT := NULLIF(trim(COALESCE(p_note, '''')), '''');
  v_suppression_status TEXT;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to resolve operations issues'';
  END IF;

  SELECT * INTO v_issue FROM public.v_operations_issue_inbox
  WHERE id = p_issue_id OR issue_key = p_issue_id LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Operations issue % not found or already closed'', p_issue_id;
  END IF;

  v_action := COALESCE(NULLIF(trim(p_action), ''''), v_issue.primary_action, ''dismiss'');

  IF v_action IN (''dismiss'', ''resolve'', ''suppress'') AND v_note IS NULL THEN
    RAISE EXCEPTION ''A reason is required to % an operations issue'', v_action;
  END IF;

  IF v_action IN (''dismiss'', ''resolve'', ''suppress'') THEN
    v_suppression_status := CASE WHEN v_action = ''resolve'' THEN ''resolved''
                                 WHEN v_action = ''suppress'' THEN ''suppressed''
                                 ELSE ''dismissed'' END;

    INSERT INTO public.operations_issue_suppression (
      issue_key, status, reason, action, evidence, created_by, expires_at
    ) VALUES (
      v_issue.issue_key, v_suppression_status, v_note, v_action,
      COALESCE(p_evidence, ''{}''::jsonb) || jsonb_build_object(
        ''issue_id'', v_issue.id, ''issue_type'', v_issue.issue_type,
        ''domain'', v_issue.domain, ''dismissed_at'', now()
      ),
      auth.uid(),
      CASE WHEN v_action = ''suppress'' THEN now() + INTERVAL ''18 months'' ELSE NULL END
    )
    ON CONFLICT (issue_key) DO UPDATE
    SET status = EXCLUDED.status, reason = EXCLUDED.reason, action = EXCLUDED.action,
        evidence = EXCLUDED.evidence, created_by = EXCLUDED.created_by,
        expires_at = EXCLUDED.expires_at, updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    ''success'', true,
    ''issue_id'', v_issue.id,
    ''issue_key'', v_issue.issue_key,
    ''action'', v_action,
    ''source_table'', v_issue.source_table,
    ''source_id'', v_issue.source_id
  );
END;
';

GRANT EXECUTE ON FUNCTION public.resolve_operations_issue(TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
