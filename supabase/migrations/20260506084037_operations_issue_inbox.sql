-- Replace the user-facing subledger workflow with an actionable operations issue inbox.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar quotes.

ALTER TABLE public.channel_pricing_config
  ADD COLUMN IF NOT EXISTS price_issue_tolerance_pct NUMERIC(8,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS price_issue_tolerance_amount NUMERIC(12,2) NOT NULL DEFAULT 2.00;

CREATE TABLE IF NOT EXISTS public.operations_issue_suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'dismissed'
    CHECK (status IN ('dismissed', 'resolved', 'suppressed')),
  reason TEXT NOT NULL,
  action TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.operations_issue_suppression ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operations_issue_suppression_staff_all
  ON public.operations_issue_suppression;

CREATE POLICY operations_issue_suppression_staff_all
  ON public.operations_issue_suppression
  FOR ALL TO authenticated
  USING (public.subledger_staff_read_policy())
  WITH CHECK (public.subledger_staff_read_policy());

DROP TRIGGER IF EXISTS set_operations_issue_suppression_updated_at
  ON public.operations_issue_suppression;

CREATE TRIGGER set_operations_issue_suppression_updated_at
  BEFORE UPDATE ON public.operations_issue_suppression
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_operations_issue_suppression_active
  ON public.operations_issue_suppression(issue_key, status, expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations_issue_suppression
  TO authenticated, service_role;

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
    inbox.id AS source_id,
    COALESCE(
      CASE WHEN inbox.sales_order_id IS NOT NULL THEN 'sales_order' END,
      CASE WHEN inbox.sales_order_line_id IS NOT NULL THEN 'sales_order_line' END,
      inbox.related_entity_type,
      'reconciliation_case'
    ) AS primary_entity_type,
    COALESCE(inbox.sales_order_id, inbox.sales_order_line_id, inbox.related_entity_id, inbox.id) AS primary_entity_id,
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
    so.id,
    'sales_order',
    so.id,
    so.order_number,
    COALESCE(so.origin_reference, so.payment_reference),
    'App sale has not posted to QBO',
    'The order is active/recent in the app but there is no QBO sales receipt id, posting reference, or queued posting intent.',
    jsonb_build_object(
      'app', jsonb_build_object(
        'sales_order_id', so.id,
        'order_number', so.order_number,
        'origin_channel', so.origin_channel,
        'origin_reference', so.origin_reference,
        'gross_total', so.gross_total,
        'currency', so.currency,
        'customer_id', so.customer_id,
        'qbo_sales_receipt_id', so.qbo_sales_receipt_id,
        'qbo_sync_status', so.qbo_sync_status,
        'qbo_last_error', so.qbo_last_error
      ),
      'qbo', jsonb_build_object('posting_reference', NULL)
    ),
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
      SELECT 1
      FROM public.qbo_posting_reference ref
      WHERE ref.local_entity_type = 'sales_order'
        AND ref.local_entity_id = so.id
        AND ref.qbo_entity_type IN ('sales_receipt', 'SalesReceipt')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.posting_intent pi
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
    raw.id,
    'qbo_sales_receipt',
    raw.id,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    'QBO sales receipt is not linked to an app sale',
    'QBO has a recent sales receipt landing record that does not match any app order by QBO id, document number, or known external references.',
    jsonb_build_object(
      'qbo', jsonb_build_object(
        'landing_id', raw.id,
        'external_id', raw.external_id,
        'doc_number', raw.raw_payload->>'DocNumber',
        'total_amount', raw.raw_payload->>'TotalAmt',
        'txn_date', raw.raw_payload->>'TxnDate',
        'customer_ref', raw.raw_payload #>> '{CustomerRef,value}',
        'status', raw.status,
        'error_message', raw.error_message
      ),
      'app_match', NULL
    ),
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
      SELECT 1
      FROM public.sales_order so
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
    pb.id,
    'purchase_batch',
    pb.id,
    COALESCE(pb.reference, pb.id::text),
    pb.supplier_name,
    'App purchase has not posted to QBO',
    'The purchase batch is recorded in the app, but there is no QBO purchase id, posting reference, or queued purchase posting intent.',
    jsonb_build_object(
      'app', jsonb_build_object(
        'purchase_batch_id', pb.id,
        'reference', pb.reference,
        'supplier_name', pb.supplier_name,
        'purchase_date', pb.purchase_date,
        'qbo_purchase_id', pb.qbo_purchase_id,
        'qbo_sync_status', pb.qbo_sync_status,
        'qbo_sync_error', pb.qbo_sync_error
      ),
      'qbo', jsonb_build_object('posting_reference', NULL)
    ),
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
      SELECT 1
      FROM public.qbo_posting_reference ref
      WHERE ref.local_entity_type IN ('purchase_batch', 'purchase')
        AND ref.local_entity_id = pb.id
        AND ref.qbo_entity_type IN ('purchase', 'Purchase')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.posting_intent pi
      WHERE pi.target_system = 'qbo'
        AND pi.action IN ('create_purchase', 'update_purchase')
        AND pi.entity_type = 'purchase_batch'
        AND COALESCE(pi.payload->>'batch_id', pi.payload->>'purchase_batch_id') = pb.id::text
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
    raw.id,
    'qbo_purchase',
    raw.id,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    'QBO purchase is not linked to an app purchase',
    'QBO has a recent purchase landing record that does not match a recorded app purchase by QBO id or reference.',
    jsonb_build_object(
      'qbo', jsonb_build_object(
        'landing_id', raw.id,
        'external_id', raw.external_id,
        'doc_number', raw.raw_payload->>'DocNumber',
        'total_amount', raw.raw_payload->>'TotalAmt',
        'txn_date', raw.raw_payload->>'TxnDate',
        'vendor_ref', raw.raw_payload #>> '{EntityRef,value}',
        'status', raw.status,
        'error_message', raw.error_message
      ),
      'app_match', NULL
    ),
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
      SELECT 1
      FROM public.purchase_batches pb
      WHERE pb.qbo_purchase_id = raw.external_id
         OR NULLIF(pb.reference, '') = NULLIF(raw.raw_payload->>'DocNumber', '')
    )

  UNION ALL

  SELECT
    'sales_order:duplicate_app:' || md5(tx.duplicate_key),
    'sales_order:duplicate_app:' || md5(tx.duplicate_key),
    'transactions',
    'duplicate_app_transaction',
    'medium',
    'open',
    0.68::NUMERIC(4,2),
    'app',
    'sales_order',
    NULL::UUID,
    'sales_order',
    NULL::UUID,
    tx.duplicate_key,
    NULL::TEXT,
    'Possible duplicate app sales transactions',
    'Multiple active app orders share the same strong reference or transaction fingerprint. This is a review candidate, not an automatic merge.',
    jsonb_build_object(
      'duplicate_key', tx.duplicate_key,
      'order_ids', tx.order_ids,
      'order_numbers', tx.order_numbers,
      'amounts', tx.amounts,
      'origin_channels', tx.origin_channels
    ),
    'Review the candidate orders and merge, cancel, or dismiss the false positive with a reason.',
    'review_duplicate',
    jsonb_build_array('review_duplicate', 'merge_transaction', 'dismiss'),
    '/admin/orders',
    tx.duplicate_key,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    tx.created_at,
    tx.updated_at,
    50
  FROM (
    SELECT
      COALESCE(
        'qbo:' || NULLIF(so.qbo_sales_receipt_id, ''),
        'doc:' || NULLIF(so.doc_number, ''),
        'origin:' || NULLIF(so.origin_reference, ''),
        'fingerprint:' || lower(COALESCE(so.origin_channel, 'unknown')) || ':' || COALESCE(so.currency, 'GBP') || ':' || round(COALESCE(so.gross_total, 0), 2)::text || ':' || so.created_at::date::text || ':' || COALESCE(so.customer_id::text, lower(COALESCE(so.guest_email, so.guest_name, 'cash')))
      ) AS duplicate_key,
      jsonb_agg(so.id ORDER BY so.created_at) AS order_ids,
      jsonb_agg(so.order_number ORDER BY so.created_at) AS order_numbers,
      jsonb_agg(so.gross_total ORDER BY so.created_at) AS amounts,
      jsonb_agg(so.origin_channel ORDER BY so.created_at) AS origin_channels,
      MIN(so.created_at) AS created_at,
      MAX(so.updated_at) AS updated_at,
      COUNT(*) AS match_count
    FROM public.sales_order so
    WHERE so.created_at >= now() - INTERVAL '18 months'
      AND COALESCE(so.is_test, false) IS FALSE
      AND so.status::text NOT IN ('cancelled', 'refunded')
    GROUP BY 1
  ) tx
  WHERE tx.match_count > 1

  UNION ALL

  SELECT
    'qbo_sales_receipt:duplicate:' || md5(tx.duplicate_key),
    'qbo_sales_receipt:duplicate:' || md5(tx.duplicate_key),
    'transactions',
    'duplicate_qbo_transaction',
    'medium',
    'open',
    0.70::NUMERIC(4,2),
    'qbo',
    'landing_raw_qbo_sales_receipt',
    NULL::UUID,
    'qbo_sales_receipt',
    NULL::UUID,
    tx.duplicate_key,
    NULL::TEXT,
    'Possible duplicate QBO sales receipts',
    'Multiple QBO sales receipt landing records share a document number or transaction fingerprint. This needs human review before linking.',
    jsonb_build_object(
      'duplicate_key', tx.duplicate_key,
      'landing_ids', tx.landing_ids,
      'external_ids', tx.external_ids,
      'doc_numbers', tx.doc_numbers,
      'totals', tx.totals
    ),
    'Review the QBO records and link only the correct receipt to the app sale.',
    'review_duplicate',
    jsonb_build_array('review_duplicate', 'link_transaction', 'dismiss'),
    '/admin/settings/app-health',
    tx.duplicate_key,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    tx.created_at,
    tx.updated_at,
    55
  FROM (
    SELECT
      COALESCE(
        'doc:' || NULLIF(raw.raw_payload->>'DocNumber', ''),
        'fingerprint:' || COALESCE(raw.raw_payload->>'TxnDate', raw.received_at::date::text) || ':' || COALESCE(raw.raw_payload->>'TotalAmt', '0') || ':' || COALESCE(raw.raw_payload #>> '{CustomerRef,value}', 'unknown')
      ) AS duplicate_key,
      jsonb_agg(raw.id ORDER BY raw.received_at) AS landing_ids,
      jsonb_agg(raw.external_id ORDER BY raw.received_at) AS external_ids,
      jsonb_agg(raw.raw_payload->>'DocNumber' ORDER BY raw.received_at) AS doc_numbers,
      jsonb_agg(raw.raw_payload->>'TotalAmt' ORDER BY raw.received_at) AS totals,
      MIN(raw.received_at) AS created_at,
      MAX(COALESCE(raw.processed_at, raw.received_at)) AS updated_at,
      COUNT(*) AS match_count
    FROM public.landing_raw_qbo_sales_receipt raw
    WHERE raw.received_at >= now() - INTERVAL '18 months'
      AND raw.status NOT IN ('error', 'skipped')
    GROUP BY 1
  ) tx
  WHERE tx.match_count > 1

  UNION ALL

  SELECT
    'customer:incomplete:' || c.id::text,
    'customer:incomplete:' || c.id::text,
    'customers',
    'incomplete_customer_record',
    'medium',
    'open',
    0.88::NUMERIC(4,2),
    'app',
    'customer',
    c.id,
    'customer',
    c.id,
    c.display_name,
    c.qbo_customer_id,
    'Customer record is incomplete',
    'The customer is active and has recent sales, but the app is missing core identity or contact data needed for reliable channel and QBO matching.',
    jsonb_build_object(
      'customer', jsonb_build_object(
        'id', c.id,
        'display_name', c.display_name,
        'email', c.email,
        'phone', c.phone,
        'mobile', c.mobile,
        'qbo_customer_id', c.qbo_customer_id,
        'channel_ids', c.channel_ids
      ),
      'recent_sales_count', COUNT(so.id)
    ),
    'Complete the customer profile or link it to the correct QBO/customer channel identity.',
    'fix_customer_record',
    jsonb_build_array('fix_customer_record', 'link_customer', 'dismiss'),
    '/admin/customers/' || c.id::text,
    c.display_name,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    MAX(so.created_at),
    c.updated_at,
    65
  FROM public.customer c
  JOIN public.sales_order so ON so.customer_id = c.id
  WHERE c.active IS TRUE
    AND so.created_at >= now() - INTERVAL '18 months'
    AND (
      NULLIF(trim(COALESCE(c.display_name, '')), '') IS NULL
      OR (
        NULLIF(trim(COALESCE(c.email, '')), '') IS NULL
        AND NULLIF(trim(COALESCE(c.phone, '')), '') IS NULL
        AND NULLIF(trim(COALESCE(c.mobile, '')), '') IS NULL
      )
      OR NULLIF(trim(COALESCE(c.qbo_customer_id, '')), '') IS NULL
    )
  GROUP BY c.id

  UNION ALL

  SELECT
    'sales_order:customer_mapping:' || so.id::text,
    'sales_order:customer_mapping:' || so.id::text,
    'customers',
    CASE
      WHEN so.customer_id IS NULL THEN 'cash_sale_customer_review_needed'
      ELSE 'qbo_app_customer_mismatch'
    END,
    CASE WHEN so.customer_id IS NULL THEN 'low' ELSE 'high' END,
    'open',
    CASE WHEN so.customer_id IS NULL THEN 0.74 ELSE 0.90 END::NUMERIC(4,2),
    'app',
    'sales_order',
    so.id,
    'sales_order',
    so.id,
    so.order_number,
    COALESCE(so.guest_email, so.qbo_customer_id, c.qbo_customer_id),
    CASE
      WHEN so.customer_id IS NULL THEN 'Sale needs customer review'
      ELSE 'Sale customer does not match QBO customer'
    END,
    CASE
      WHEN so.customer_id IS NULL THEN 'The sale is recent and not clearly mapped to a customer record. Cash sale may be correct, but it needs a human decision before customer or QBO cleanup.'
      ELSE 'The app customer and sales order QBO customer reference differ, which can post the sale to the wrong customer in QBO.'
    END,
    jsonb_build_object(
      'order', jsonb_build_object(
        'sales_order_id', so.id,
        'order_number', so.order_number,
        'origin_channel', so.origin_channel,
        'guest_name', so.guest_name,
        'guest_email', so.guest_email,
        'sales_order_qbo_customer_id', so.qbo_customer_id
      ),
      'customer', jsonb_build_object(
        'customer_id', c.id,
        'display_name', c.display_name,
        'qbo_customer_id', c.qbo_customer_id
      )
    ),
    'Open the order, confirm the buyer identity, and reassign or link the customer before posting or correcting QBO.',
    'fix_customer_mapping',
    jsonb_build_array('fix_customer_mapping', 'reassign_customer', 'dismiss'),
    '/admin/orders/' || so.id::text,
    so.order_number,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    so.created_at,
    so.updated_at,
    60
  FROM public.sales_order so
  LEFT JOIN public.customer c ON c.id = so.customer_id
  WHERE so.created_at >= now() - INTERVAL '18 months'
    AND COALESCE(so.is_test, false) IS FALSE
    AND so.status::text NOT IN ('cancelled', 'refunded')
    AND (
      (so.customer_id IS NULL AND (NULLIF(trim(COALESCE(so.guest_email, '')), '') IS NOT NULL OR NULLIF(trim(COALESCE(so.guest_name, '')), '') IS NOT NULL))
      OR (
        so.customer_id IS NOT NULL
        AND so.qbo_customer_id IS NOT NULL
        AND c.qbo_customer_id IS NOT NULL
        AND so.qbo_customer_id <> c.qbo_customer_id
      )
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
    sol.id,
    'sales_order',
    so.id,
    so.order_number,
    sk.sku_code,
    'Order line has no stock allocation',
    'The order cannot have final COGS, margin, or reliable fulfilment until a specific stock unit is allocated.',
    jsonb_build_object(
      'order', jsonb_build_object('sales_order_id', so.id, 'order_number', so.order_number, 'status', so.status, 'v2_status', so.v2_status),
      'line', jsonb_build_object('sales_order_line_id', sol.id, 'sku_id', sol.sku_id, 'sku_code', sk.sku_code, 'quantity', sol.quantity, 'stock_unit_id', sol.stock_unit_id, 'economics_status', sol.economics_status),
      'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0), 'candidate_stock_units', COALESCE(av.stock_unit_ids, '[]'::jsonb))
    ),
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
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Out-of-stock SKU is listed for sale',
    'The channel listing appears live or quantity-bearing, but no available stock units exist for the SKU.',
    jsonb_build_object(
      'listing', jsonb_build_object(
        'channel_listing_id', cl.id,
        'channel', cl.channel,
        'external_sku', cl.external_sku,
        'external_listing_id', cl.external_listing_id,
        'listed_quantity', cl.listed_quantity,
        'v2_status', cl.v2_status,
        'offer_status', cl.offer_status,
        'availability_override', cl.availability_override
      ),
      'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0))
    ),
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
    'channel_listing:quantity_mismatch:' || cl.id::text,
    'channel_listing:quantity_mismatch:' || cl.id::text,
    'inventory',
    'channel_quantity_mismatch',
    'medium',
    'open',
    0.89::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Channel listing quantity differs from available stock',
    'The channel-visible quantity is not aligned to available app stock. That can create oversells or hidden saleable inventory.',
    jsonb_build_object(
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'listed_quantity', cl.listed_quantity, 'availability_override', cl.availability_override),
      'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0), 'candidate_stock_units', COALESCE(av.stock_unit_ids, '[]'::jsonb))
    ),
    'Sync listing quantity to the channel after checking whether a manual out-of-stock override is still intentional.',
    'sync_listing_quantity',
    jsonb_build_array('sync_listing_quantity', 'pause_listing', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    COALESCE(cl.listed_quantity, 0)::NUMERIC,
    COALESCE(av.available_quantity, 0)::NUMERIC,
    COALESCE(cl.listed_quantity, 0)::NUMERIC - COALESCE(av.available_quantity, 0)::NUMERIC,
    cl.created_at,
    cl.updated_at,
    70
  FROM public.channel_listing cl
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  LEFT JOIN available_stock av ON av.sku_id = cl.sku_id
  WHERE COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('live', 'ACTIVE', 'active')
    AND COALESCE(cl.listed_quantity, 0) <> COALESCE(av.available_quantity, 0)
    AND NOT (COALESCE(av.available_quantity, 0) = 0 AND COALESCE(cl.listed_quantity, 1) > 0 AND cl.availability_override IS NULL)

  UNION ALL

  SELECT
    'channel_listing:manual_oos_review:' || cl.id::text,
    'channel_listing:manual_oos_review:' || cl.id::text,
    'inventory',
    'manual_out_of_stock_override_needs_review',
    'low',
    'open',
    0.82::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Manual out-of-stock override needs review',
    'The listing is manually held out of stock even though available stock exists in the app.',
    jsonb_build_object(
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'availability_override', cl.availability_override, 'listed_quantity', cl.listed_quantity),
      'inventory', jsonb_build_object('available_quantity', COALESCE(av.available_quantity, 0), 'candidate_stock_units', COALESCE(av.stock_unit_ids, '[]'::jsonb))
    ),
    'Remove the override or sync quantity if the SKU should be available for sale.',
    'sync_listing_quantity',
    jsonb_build_array('sync_listing_quantity', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    COALESCE(cl.listed_quantity, 0)::NUMERIC,
    COALESCE(av.available_quantity, 0)::NUMERIC,
    COALESCE(cl.listed_quantity, 0)::NUMERIC - COALESCE(av.available_quantity, 0)::NUMERIC,
    cl.created_at,
    cl.updated_at,
    85
  FROM public.channel_listing cl
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  LEFT JOIN available_stock av ON av.sku_id = cl.sku_id
  WHERE cl.availability_override = 'manual_out_of_stock'
    AND COALESCE(av.available_quantity, 0) > 0

  UNION ALL

  SELECT
    'product:missing_primary_image:' || p.id::text,
    'product:missing_primary_image:' || p.id::text,
    'products',
    'missing_primary_image',
    'medium',
    'open',
    0.94::NUMERIC(4,2),
    'app',
    'product',
    p.id,
    'product',
    p.id,
    COALESCE(p.name, p.mpn, p.id::text),
    p.mpn,
    'Product is missing a primary image',
    'The product is active or listed, but there is no primary media asset or fallback image URL. Listings can be blocked or low-quality.',
    jsonb_build_object('product', jsonb_build_object('product_id', p.id, 'name', p.name, 'mpn', p.mpn, 'img_url', p.img_url)),
    'Add or select a primary product image before publishing or refreshing channel listings.',
    'fix_product_media',
    jsonb_build_array('fix_product_media', 'dismiss'),
    '/admin/products/' || p.id::text,
    COALESCE(p.name, p.mpn),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    p.created_at,
    p.updated_at,
    80
  FROM public.product p
  WHERE COALESCE(p.status, 'active') NOT IN ('archived', 'deleted', 'inactive')
    AND NULLIF(trim(COALESCE(p.img_url, '')), '') IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_media pm
      JOIN public.media_asset ma ON ma.id = pm.media_asset_id
      WHERE pm.product_id = p.id
        AND pm.is_primary IS TRUE
        AND NULLIF(trim(COALESCE(ma.original_url, '')), '') IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.sku sk
      LEFT JOIN public.channel_listing cl ON cl.sku_id = sk.id
      WHERE sk.product_id = p.id
        AND (sk.active_flag IS TRUE OR COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('draft', 'live', 'ACTIVE', 'active'))
    )

  UNION ALL

  SELECT
    'product:missing_specs:' || spec.product_id::text || ':' || md5(spec.channel || ':' || spec.category_id),
    'product:missing_specs:' || spec.product_id::text || ':' || md5(spec.channel || ':' || spec.category_id),
    'products',
    'missing_required_specs',
    'medium',
    'open',
    0.88::NUMERIC(4,2),
    'app',
    'product',
    spec.product_id,
    'product',
    spec.product_id,
    spec.product_label,
    spec.category_id,
    'Product is missing required channel specs',
    'The selected channel category requires attributes that are not populated on the source product data.',
    jsonb_build_object(
      'product_id', spec.product_id,
      'channel', spec.channel,
      'marketplace', spec.marketplace,
      'category_id', spec.category_id,
      'missing_attributes', spec.missing_attributes
    ),
    'Populate the required specs from source data or add an approved manual value before publishing.',
    'fix_product_specs',
    jsonb_build_array('fix_product_specs', 'dismiss'),
    '/admin/products/' || spec.product_id::text,
    spec.product_label,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    spec.created_at,
    spec.updated_at,
    78
  FROM (
    SELECT
      p.id AS product_id,
      COALESCE(p.name, p.mpn, p.id::text) AS product_label,
      schema.channel,
      schema.marketplace,
      schema.category_id,
      jsonb_agg(jsonb_build_object('key', attr.key, 'label', attr.label) ORDER BY attr.sort_order, attr.key) AS missing_attributes,
      p.created_at,
      p.updated_at
    FROM public.product p
    JOIN public.channel_category_schema schema
      ON schema.channel = 'ebay'
     AND schema.category_id = p.ebay_category_id
     AND schema.marketplace = COALESCE(p.ebay_marketplace, 'EBAY_GB')
    JOIN public.channel_category_attribute attr ON attr.schema_id = schema.id
    LEFT JOIN public.product_attribute pa
      ON pa.product_id = p.id
     AND pa.namespace = schema.channel
     AND pa.key = attr.key
    WHERE COALESCE(p.status, 'active') NOT IN ('archived', 'deleted', 'inactive')
      AND attr.required IS TRUE
      AND (pa.id IS NULL OR NULLIF(trim(COALESCE(pa.value, pa.value_json::text, '')), '') IS NULL)
    GROUP BY p.id, schema.channel, schema.marketplace, schema.category_id
  ) spec

  UNION ALL

  SELECT
    'product:required_attribute_unmapped:' || map_gap.product_id::text || ':' || md5(map_gap.channel || ':' || map_gap.category_id),
    'product:required_attribute_unmapped:' || map_gap.product_id::text || ':' || md5(map_gap.channel || ':' || map_gap.category_id),
    'products',
    'required_channel_attribute_unmapped',
    'medium',
    'open',
    0.83::NUMERIC(4,2),
    'channel',
    'product',
    map_gap.product_id,
    'product',
    map_gap.product_id,
    map_gap.product_label,
    map_gap.category_id,
    'Required channel attribute is unmapped',
    'A required channel/category attribute has no source mapping or constant value, so listing data cannot be generated reliably.',
    jsonb_build_object(
      'product_id', map_gap.product_id,
      'channel', map_gap.channel,
      'marketplace', map_gap.marketplace,
      'category_id', map_gap.category_id,
      'unmapped_attributes', map_gap.unmapped_attributes
    ),
    'Map the required channel attribute to a canonical source field or approved constant.',
    'fix_product_specs',
    jsonb_build_array('fix_product_specs', 'dismiss'),
    '/admin/settings/channel-mappings',
    map_gap.product_label,
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    map_gap.created_at,
    map_gap.updated_at,
    82
  FROM (
    SELECT
      p.id AS product_id,
      COALESCE(p.name, p.mpn, p.id::text) AS product_label,
      schema.channel,
      schema.marketplace,
      schema.category_id,
      jsonb_agg(jsonb_build_object('key', attr.key, 'label', attr.label) ORDER BY attr.sort_order, attr.key) AS unmapped_attributes,
      p.created_at,
      p.updated_at
    FROM public.product p
    JOIN public.channel_category_schema schema
      ON schema.channel = 'ebay'
     AND schema.category_id = p.ebay_category_id
     AND schema.marketplace = COALESCE(p.ebay_marketplace, 'EBAY_GB')
    JOIN public.channel_category_attribute attr ON attr.schema_id = schema.id
    LEFT JOIN public.channel_attribute_mapping mapping
      ON mapping.channel = schema.channel
     AND COALESCE(mapping.marketplace, schema.marketplace) = schema.marketplace
     AND (mapping.category_id = schema.category_id OR mapping.category_id IS NULL)
     AND mapping.aspect_key = attr.key
     AND (mapping.canonical_key IS NOT NULL OR mapping.constant_value IS NOT NULL)
    WHERE COALESCE(p.status, 'active') NOT IN ('archived', 'deleted', 'inactive')
      AND attr.required IS TRUE
      AND mapping.id IS NULL
    GROUP BY p.id, schema.channel, schema.marketplace, schema.category_id
  ) map_gap

  UNION ALL

  SELECT
    'channel_listing:quality_gap:' || cl.id::text,
    'channel_listing:quality_gap:' || cl.id::text,
    'products',
    'listing_copy_or_image_quality_gap',
    'low',
    'open',
    0.78::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Listing data is incomplete',
    'The listing is active or draft but is missing title, description, SKU, external id, or product media needed for a useful channel listing.',
    jsonb_build_object(
      'listing', jsonb_build_object(
        'channel_listing_id', cl.id,
        'channel', cl.channel,
        'external_sku', cl.external_sku,
        'external_listing_id', cl.external_listing_id,
        'listing_title', cl.listing_title,
        'has_description', NULLIF(trim(COALESCE(cl.listing_description, '')), '') IS NOT NULL
      ),
      'product', jsonb_build_object('product_id', p.id, 'name', p.name, 'mpn', p.mpn, 'img_url', p.img_url)
    ),
    'Fix the listing title, description, identifiers, or media before publishing/syncing the listing.',
    'fix_listing_data',
    jsonb_build_array('fix_listing_data', 'fix_product_media', 'dismiss'),
    COALESCE('/admin/products/' || p.id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, p.name),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    cl.created_at,
    cl.updated_at,
    90
  FROM public.channel_listing cl
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  LEFT JOIN public.product p ON p.id = sk.product_id
  WHERE COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('draft', 'live', 'ACTIVE', 'active')
    AND (
      NULLIF(trim(COALESCE(cl.listing_title, '')), '') IS NULL
      OR NULLIF(trim(COALESCE(cl.listing_description, '')), '') IS NULL
      OR NULLIF(trim(COALESCE(cl.external_sku, sk.sku_code, '')), '') IS NULL
      OR (COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('live', 'ACTIVE', 'active') AND NULLIF(trim(COALESCE(cl.external_listing_id, '')), '') IS NULL)
      OR (p.id IS NOT NULL AND NULLIF(trim(COALESCE(p.img_url, '')), '') IS NULL AND NOT EXISTS (
        SELECT 1
        FROM public.product_media pm
        JOIN public.media_asset ma ON ma.id = pm.media_asset_id
        WHERE pm.product_id = p.id
          AND pm.is_primary IS TRUE
          AND NULLIF(trim(COALESCE(ma.original_url, '')), '') IS NOT NULL
      ))
    )

  UNION ALL

  SELECT
    'channel_listing:price_target_mismatch:' || cl.id::text,
    'channel_listing:price_target_mismatch:' || cl.id::text,
    'products',
    'floor_or_target_price_mismatch_outside_tolerance',
    'medium',
    'open',
    0.90::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Listing price differs from target outside tolerance',
    'The channel listing price differs from the latest target price by more than the configured channel tolerance.',
    jsonb_build_object(
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'listed_price', cl.listed_price, 'external_sku', cl.external_sku),
      'pricing', jsonb_build_object('snapshot_id', pds.id, 'target_price', pds.target_price, 'floor_price', pds.floor_price, 'tolerance_pct', COALESCE(cfg.price_issue_tolerance_pct, 0.05), 'tolerance_amount', COALESCE(cfg.price_issue_tolerance_amount, 2.00))
    ),
    'Refresh pricing or approve an explicit override before publishing another price update.',
    'refresh_price',
    jsonb_build_array('refresh_price', 'approve_price_override', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    pds.target_price,
    cl.listed_price,
    cl.listed_price - pds.target_price,
    cl.created_at,
    GREATEST(cl.updated_at, pds.created_at),
    88
  FROM public.channel_listing cl
  JOIN public.price_decision_snapshot pds ON pds.id = cl.current_price_decision_snapshot_id
  LEFT JOIN public.channel_pricing_config cfg ON cfg.channel = cl.channel
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  WHERE cl.listed_price IS NOT NULL
    AND pds.target_price IS NOT NULL
    AND abs(cl.listed_price - pds.target_price) > GREATEST(abs(pds.target_price) * COALESCE(cfg.price_issue_tolerance_pct, 0.05), COALESCE(cfg.price_issue_tolerance_amount, 2.00))

  UNION ALL

  SELECT
    'channel_listing:below_floor:' || cl.id::text,
    'channel_listing:below_floor:' || cl.id::text,
    'products',
    'price_below_floor_without_approval',
    'high',
    'open',
    0.94::NUMERIC(4,2),
    'channel',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Listing price is below floor',
    'The channel listing price is below the latest floor price and no price override evidence is attached to the snapshot.',
    jsonb_build_object(
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'listed_price', cl.listed_price, 'external_sku', cl.external_sku),
      'pricing', jsonb_build_object('snapshot_id', pds.id, 'floor_price', pds.floor_price, 'target_price', pds.target_price, 'override_required', pds.override_required, 'blocking_reasons', pds.blocking_reasons)
    ),
    'Raise the listing price or record an audited price override before allowing the listing to continue.',
    'approve_price_override',
    jsonb_build_array('approve_price_override', 'refresh_price', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    pds.floor_price,
    cl.listed_price,
    cl.listed_price - pds.floor_price,
    cl.created_at,
    GREATEST(cl.updated_at, pds.created_at),
    22
  FROM public.channel_listing cl
  JOIN public.price_decision_snapshot pds ON pds.id = cl.current_price_decision_snapshot_id
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  WHERE cl.listed_price IS NOT NULL
    AND pds.floor_price IS NOT NULL
    AND cl.listed_price < pds.floor_price

  UNION ALL

  SELECT
    'channel_listing:stale_price_snapshot:' || cl.id::text,
    'channel_listing:stale_price_snapshot:' || cl.id::text,
    'products',
    'stale_price_snapshot',
    'low',
    'open',
    0.80::NUMERIC(4,2),
    'app',
    'channel_listing',
    cl.id,
    'channel_listing',
    cl.id,
    COALESCE(cl.external_sku, sk.sku_code, cl.id::text),
    cl.external_listing_id,
    'Listing price snapshot is stale',
    'The listing is active, but its pricing decision snapshot is older than 30 days or missing.',
    jsonb_build_object(
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'channel', cl.channel, 'listed_price', cl.listed_price, 'current_snapshot_id', cl.current_price_decision_snapshot_id),
      'pricing', jsonb_build_object('snapshot_created_at', pds.created_at)
    ),
    'Refresh the price snapshot and decide whether the live listing needs a price update.',
    'refresh_price',
    jsonb_build_array('refresh_price', 'dismiss'),
    COALESCE('/admin/products/' || sk.product_id::text, '/admin/operations'),
    COALESCE(cl.external_sku, sk.sku_code, cl.external_listing_id),
    NULL::NUMERIC,
    cl.listed_price,
    NULL::NUMERIC,
    cl.created_at,
    cl.updated_at,
    95
  FROM public.channel_listing cl
  LEFT JOIN public.price_decision_snapshot pds ON pds.id = cl.current_price_decision_snapshot_id
  LEFT JOIN public.sku sk ON sk.id = cl.sku_id
  WHERE COALESCE(cl.v2_status::text, cl.offer_status, '') IN ('live', 'ACTIVE', 'active')
    AND (pds.id IS NULL OR pds.created_at < now() - INTERVAL '30 days')

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
    pi.id,
    pi.entity_type,
    pi.entity_id,
    COALESCE(pi.payload->>'order_number', pi.payload->>'reference', pi.payload->>'batch_id', pi.id::text),
    pi.action,
    'QBO posting failed',
    'A QBO posting intent has failed or exhausted retries. The failed item should show the source record, error, and retry path.',
    jsonb_build_object(
      'posting_intent', jsonb_build_object(
        'id', pi.id,
        'target_system', pi.target_system,
        'action', pi.action,
        'entity_type', pi.entity_type,
        'entity_id', pi.entity_id,
        'status', pi.status,
        'retry_count', pi.retry_count,
        'last_error', pi.last_error,
        'next_attempt_at', pi.next_attempt_at,
        'payload', pi.payload
      )
    ),
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
    AND (
      pi.status = 'failed'
      OR (pi.status IN ('pending', 'processing') AND pi.created_at < now() - INTERVAL '24 hours')
    )

  UNION ALL

  SELECT
    'outbound_command:failed:' || cmd.id::text,
    'outbound_command:failed:' || cmd.id::text,
    'integrations',
    CASE
      WHEN cmd.last_error ILIKE '%valid%' THEN 'third_party_validation_error'
      ELSE 'outbox_failed_after_retries'
    END,
    CASE WHEN cmd.retry_count >= 3 THEN 'high' ELSE 'medium' END,
    'open',
    0.94::NUMERIC(4,2),
    cmd.target_system,
    'outbound_command',
    cmd.id,
    cmd.entity_type,
    cmd.entity_id,
    COALESCE(cl.external_sku, sk.sku_code, cmd.id::text),
    cmd.command_type,
    'Channel command failed',
    'A third-party listing/channel command failed or stalled and needs a concrete retry, cancellation, or source-data fix.',
    jsonb_build_object(
      'outbound_command', jsonb_build_object(
        'id', cmd.id,
        'target_system', cmd.target_system,
        'command_type', cmd.command_type,
        'entity_type', cmd.entity_type,
        'entity_id', cmd.entity_id,
        'status', cmd.status,
        'retry_count', cmd.retry_count,
        'last_error', cmd.last_error,
        'next_attempt_at', cmd.next_attempt_at,
        'payload', cmd.payload,
        'response_payload', cmd.response_payload
      ),
      'listing', jsonb_build_object('channel_listing_id', cl.id, 'external_sku', cl.external_sku, 'external_listing_id', cl.external_listing_id)
    ),
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
    AND (
      cmd.status = 'failed'
      OR (cmd.status IN ('pending', 'processing') AND cmd.created_at < now() - INTERVAL '24 hours')
    )

  UNION ALL

  SELECT
    'qbo_landing:error:sales_receipt:' || raw.id::text,
    'qbo_landing:error:sales_receipt:' || raw.id::text,
    'integrations',
    CASE WHEN raw.status = 'error' THEN 'landing_processor_error' ELSE 'stale_sync' END,
    CASE WHEN raw.status = 'error' THEN 'high' ELSE 'medium' END,
    'open',
    0.93::NUMERIC(4,2),
    'qbo',
    'landing_raw_qbo_sales_receipt',
    raw.id,
    'qbo_sales_receipt',
    raw.id,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    CASE WHEN raw.status = 'error' THEN 'QBO sales receipt landing errored' ELSE 'QBO sales receipt sync is stale' END,
    'A QBO landing record has either failed processing or remained pending long enough to block reliable matching.',
    jsonb_build_object('qbo', jsonb_build_object('landing_id', raw.id, 'external_id', raw.external_id, 'doc_number', raw.raw_payload->>'DocNumber', 'status', raw.status, 'error_message', raw.error_message, 'received_at', raw.received_at)),
    'Review the landing error, correct the source/config issue, then rerun the relevant sync processor.',
    'retry_integration',
    jsonb_build_array('retry_integration', 'dismiss'),
    '/admin/settings/app-health',
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    raw.received_at,
    COALESCE(raw.processed_at, raw.received_at),
    32
  FROM public.landing_raw_qbo_sales_receipt raw
  WHERE raw.status = 'error'
     OR (raw.status IN ('pending', 'retrying') AND raw.received_at < now() - INTERVAL '12 hours')

  UNION ALL

  SELECT
    'qbo_landing:error:purchase:' || raw.id::text,
    'qbo_landing:error:purchase:' || raw.id::text,
    'integrations',
    CASE WHEN raw.status = 'error' THEN 'landing_processor_error' ELSE 'stale_sync' END,
    CASE WHEN raw.status = 'error' THEN 'high' ELSE 'medium' END,
    'open',
    0.93::NUMERIC(4,2),
    'qbo',
    'landing_raw_qbo_purchase',
    raw.id,
    'qbo_purchase',
    raw.id,
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    raw.external_id,
    CASE WHEN raw.status = 'error' THEN 'QBO purchase landing errored' ELSE 'QBO purchase sync is stale' END,
    'A QBO landing record has either failed processing or remained pending long enough to block reliable matching.',
    jsonb_build_object('qbo', jsonb_build_object('landing_id', raw.id, 'external_id', raw.external_id, 'doc_number', raw.raw_payload->>'DocNumber', 'status', raw.status, 'error_message', raw.error_message, 'received_at', raw.received_at)),
    'Review the landing error, correct the source/config issue, then rerun the relevant sync processor.',
    'retry_integration',
    jsonb_build_array('retry_integration', 'dismiss'),
    '/admin/settings/app-health',
    COALESCE(raw.raw_payload->>'DocNumber', raw.external_id),
    NULL::NUMERIC,
    NULL::NUMERIC,
    NULL::NUMERIC,
    raw.received_at,
    COALESCE(raw.processed_at, raw.received_at),
    33
  FROM public.landing_raw_qbo_purchase raw
  WHERE raw.status = 'error'
     OR (raw.status IN ('pending', 'retrying') AND raw.received_at < now() - INTERVAL '12 hours')
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
  SELECT 1
  FROM public.operations_issue_suppression s
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
  v_audit_entity_type TEXT;
  v_audit_entity_id UUID;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to resolve operations issues'';
  END IF;

  SELECT * INTO v_issue
  FROM public.v_operations_issue_inbox
  WHERE id = p_issue_id OR issue_key = p_issue_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Operations issue % not found or already closed'', p_issue_id;
  END IF;

  v_action := COALESCE(NULLIF(trim(p_action), ''''), v_issue.primary_action, ''dismiss'');

  IF v_action IN (''dismiss'', ''resolve'', ''suppress'') AND v_note IS NULL THEN
    RAISE EXCEPTION ''A reason is required to % an operations issue'', v_action;
  END IF;

  IF v_action = ''queue_qbo_posting'' THEN
    IF v_issue.primary_entity_type = ''sales_order'' AND v_issue.primary_entity_id IS NOT NULL THEN
      PERFORM public.queue_qbo_posting_intents_for_order(v_issue.primary_entity_id);
    ELSIF v_issue.source_table = ''sales_order'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.queue_qbo_posting_intents_for_order(v_issue.source_id);
    ELSIF v_issue.primary_entity_type IN (''purchase_batch'', ''purchase_batches'') AND v_issue.primary_entity_id IS NOT NULL THEN
      PERFORM public.queue_qbo_purchase_posting_intent(v_issue.primary_entity_id::text, ''create_purchase'');
    ELSIF v_issue.source_table = ''purchase_batches'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.queue_qbo_purchase_posting_intent(v_issue.source_id::text, ''create_purchase'');
    ELSIF v_issue.primary_entity_type = ''customer'' AND v_issue.primary_entity_id IS NOT NULL THEN
      PERFORM public.queue_qbo_customer_posting_intent(v_issue.primary_entity_id, COALESCE(p_evidence, ''{}''::jsonb));
    ELSE
      RAISE EXCEPTION ''Issue % cannot queue QBO posting from source %'', v_issue.id, v_issue.source_table;
    END IF;

    IF v_issue.source_table = ''reconciliation_case'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.update_reconciliation_case_workflow(
        p_case_id => v_issue.source_id,
        p_status => ''in_progress'',
        p_note => v_note,
        p_evidence => COALESCE(p_evidence, ''{}''::jsonb)
      );
    END IF;

  ELSIF v_action = ''retry_integration'' THEN
    IF v_issue.source_table = ''posting_intent'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.retry_qbo_posting_intent(v_issue.source_id);
    ELSIF v_issue.source_table = ''outbound_command'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.retry_listing_outbound_command(v_issue.source_id);
    ELSIF v_issue.source_table = ''reconciliation_case'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.update_reconciliation_case_workflow(
        p_case_id => v_issue.source_id,
        p_status => ''in_progress'',
        p_note => COALESCE(v_note, ''Retry requested from Issue Inbox''),
        p_evidence => COALESCE(p_evidence, ''{}''::jsonb)
      );
    ELSE
      RAISE EXCEPTION ''Issue % does not have a retryable integration command'', v_issue.id;
    END IF;

  ELSIF v_action = ''cancel_integration'' THEN
    IF v_issue.source_table = ''posting_intent'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.cancel_qbo_posting_intent(v_issue.source_id);
    ELSIF v_issue.source_table = ''outbound_command'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.cancel_listing_outbound_command(v_issue.source_id);
    ELSE
      RAISE EXCEPTION ''Issue % does not have a cancellable integration command'', v_issue.id;
    END IF;

  ELSIF v_action = ''pause_listing'' THEN
    IF v_issue.source_table <> ''channel_listing'' OR v_issue.source_id IS NULL THEN
      RAISE EXCEPTION ''Issue % is not a channel listing pause action'', v_issue.id;
    END IF;

    UPDATE public.channel_listing
    SET availability_override = ''manual_out_of_stock'',
        availability_override_at = now(),
        availability_override_by = auth.uid(),
        updated_at = now()
    WHERE id = v_issue.source_id;

    PERFORM public.queue_listing_command(v_issue.source_id, ''sync_quantity'', auth.uid(), false);

  ELSIF v_action = ''sync_listing_quantity'' THEN
    IF v_issue.source_table <> ''channel_listing'' OR v_issue.source_id IS NULL THEN
      RAISE EXCEPTION ''Issue % is not a channel listing quantity action'', v_issue.id;
    END IF;

    PERFORM public.queue_listing_command(v_issue.source_id, ''sync_quantity'', auth.uid(), false);

  ELSIF v_action = ''start_work'' THEN
    IF v_issue.source_table = ''reconciliation_case'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.update_reconciliation_case_workflow(
        p_case_id => v_issue.source_id,
        p_status => ''in_progress'',
        p_note => COALESCE(v_note, ''Started from Issue Inbox''),
        p_evidence => COALESCE(p_evidence, ''{}''::jsonb)
      );
    ELSE
      RAISE EXCEPTION ''Issue % has no start-work workflow hook'', v_issue.id;
    END IF;

  ELSIF v_action IN (''dismiss'', ''resolve'', ''suppress'') THEN
    v_suppression_status := CASE
      WHEN v_action = ''resolve'' THEN ''resolved''
      WHEN v_action = ''suppress'' THEN ''suppressed''
      ELSE ''dismissed''
    END;

    INSERT INTO public.operations_issue_suppression (
      issue_key,
      status,
      reason,
      action,
      evidence,
      created_by,
      expires_at
    )
    VALUES (
      v_issue.issue_key,
      v_suppression_status,
      v_note,
      v_action,
      COALESCE(p_evidence, ''{}''::jsonb) || jsonb_build_object(
        ''issue_id'', v_issue.id,
        ''issue_type'', v_issue.issue_type,
        ''domain'', v_issue.domain,
        ''dismissed_at'', now()
      ),
      auth.uid(),
      CASE WHEN v_action = ''suppress'' THEN now() + INTERVAL ''18 months'' ELSE NULL END
    )
    ON CONFLICT (issue_key) DO UPDATE
    SET status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        action = EXCLUDED.action,
        evidence = EXCLUDED.evidence,
        created_by = EXCLUDED.created_by,
        expires_at = EXCLUDED.expires_at,
        updated_at = now();

    IF v_issue.source_table = ''reconciliation_case'' AND v_issue.source_id IS NOT NULL THEN
      PERFORM public.update_reconciliation_case_workflow(
        p_case_id => v_issue.source_id,
        p_status => CASE WHEN v_action = ''resolve'' THEN ''resolved'' ELSE ''ignored'' END,
        p_note => v_note,
        p_evidence => COALESCE(p_evidence, ''{}''::jsonb) || jsonb_build_object(''issue_action'', v_action)
      );
    END IF;

  ELSE
    RAISE EXCEPTION ''Unsupported operations issue action %'', v_action;
  END IF;

  v_audit_entity_type := COALESCE(v_issue.primary_entity_type, v_issue.source_table, ''operations_issue'');
  v_audit_entity_id := COALESCE(v_issue.primary_entity_id, v_issue.source_id);

  IF v_audit_entity_id IS NOT NULL THEN
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
      v_audit_entity_type,
      v_audit_entity_id,
      ''operations_issue_action'',
      ''staff'',
      auth.uid(),
      ''issue_inbox'',
      jsonb_build_object(
        ''issue_id'', v_issue.id,
        ''issue_key'', v_issue.issue_key,
        ''domain'', v_issue.domain,
        ''issue_type'', v_issue.issue_type,
        ''action'', v_action,
        ''note'', v_note,
        ''evidence'', COALESCE(p_evidence, ''{}''::jsonb)
      ),
      jsonb_build_object(''success'', true, ''source_table'', v_issue.source_table, ''source_id'', v_issue.source_id)
    );
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

GRANT EXECUTE ON FUNCTION public.resolve_operations_issue(TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;

COMMENT ON TABLE public.operations_issue_suppression IS
  'Operator suppressions/resolutions for the actionable Operations Issue Inbox. Keeps accepted mismatches and false positives out of the main queue.';

COMMENT ON VIEW public.v_operations_issue_inbox IS
  'Actionable issue read model for Operations and Work Queue. Generated from app, QBO landing, channel listing, outbox, and reconciliation inputs.';

COMMENT ON FUNCTION public.resolve_operations_issue(TEXT, TEXT, TEXT, JSONB) IS
  'Audited resolver for issue-inbox actions such as queueing QBO posts, retrying integrations, pausing listings, syncing quantity, and dismissing with a reason.';
