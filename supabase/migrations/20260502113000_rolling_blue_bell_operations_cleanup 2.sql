-- Rolling Blue Bell operations cleanup.
-- Blue Bell unpaid commission is an operational accrual workflow, not a reconciliation exception.

INSERT INTO public.sales_program_attribution (
  sales_order_id,
  sales_program_id,
  attribution_source,
  attribution_reason,
  locked_at,
  created_at
)
SELECT
  so.id,
  sp.id,
  'legacy_backfill',
  'Backfilled from legacy sales_order.blue_bell_club during rolling operations cleanup',
  COALESCE(so.created_at, now()),
  COALESCE(so.created_at, now())
FROM public.sales_order so
JOIN public.sales_program sp ON sp.program_code = 'blue_bell'
WHERE COALESCE(so.blue_bell_club, false) IS TRUE
ON CONFLICT (sales_order_id, sales_program_id) DO NOTHING;

WITH legacy_blue_bell AS (
  SELECT
    so.id AS sales_order_id,
    sp.id AS sales_program_id,
    spa.id AS attribution_id,
    ROUND(
      COALESCE(
        NULLIF(so.club_commission_amount, 0) / NULLIF(sp.default_commission_rate, 0),
        GREATEST(COALESCE(so.gross_total, 0) - COALESCE(so.shipping_total, 0), 0)
      )::numeric,
      2
    ) AS basis_amount,
    ROUND(
      COALESCE(
        NULLIF(so.club_discount_amount, 0),
        COALESCE(
          NULLIF(so.club_commission_amount, 0) / NULLIF(sp.default_commission_rate, 0),
          GREATEST(COALESCE(so.gross_total, 0) - COALESCE(so.shipping_total, 0), 0)
        ) * COALESCE(NULLIF(sp.default_discount_rate, 0), 0.05)
      )::numeric,
      2
    ) AS discount_amount,
    ROUND(
      COALESCE(
        NULLIF(so.club_commission_amount, 0),
        COALESCE(
          NULLIF(so.club_commission_amount, 0) / NULLIF(sp.default_commission_rate, 0),
          GREATEST(COALESCE(so.gross_total, 0) - COALESCE(so.shipping_total, 0), 0)
        ) * COALESCE(NULLIF(sp.default_commission_rate, 0), 0.05)
      )::numeric,
      2
    ) AS commission_amount,
    COALESCE(so.currency, 'GBP') AS currency,
    COALESCE(so.created_at, now()) AS created_at,
    jsonb_build_object(
      'source', 'legacy_blue_bell_club',
      'sales_order_id', so.id,
      'legacy_blue_bell_club', so.blue_bell_club,
      'legacy_club_discount_amount', so.club_discount_amount,
      'legacy_club_commission_amount', so.club_commission_amount,
      'gross_total', so.gross_total,
      'shipping_total', so.shipping_total
    ) AS metadata
  FROM public.sales_order so
  JOIN public.sales_program sp ON sp.program_code = 'blue_bell'
  JOIN public.sales_program_attribution spa
    ON spa.sales_order_id = so.id
   AND spa.sales_program_id = sp.id
  WHERE COALESCE(so.blue_bell_club, false) IS TRUE
)
INSERT INTO public.sales_program_accrual (
  sales_program_id,
  sales_order_id,
  attribution_id,
  accrual_type,
  basis_amount,
  discount_amount,
  commission_amount,
  reversed_amount,
  currency,
  status,
  source,
  metadata,
  created_at,
  updated_at
)
SELECT
  sales_program_id,
  sales_order_id,
  attribution_id,
  'commission',
  basis_amount,
  discount_amount,
  commission_amount,
  0,
  currency,
  CASE WHEN commission_amount > 0 THEN 'open' ELSE 'void' END,
  'legacy_blue_bell_backfill',
  metadata,
  created_at,
  now()
FROM legacy_blue_bell
WHERE commission_amount > 0
ON CONFLICT (sales_program_id, sales_order_id, accrual_type) DO UPDATE
SET
  attribution_id = COALESCE(public.sales_program_accrual.attribution_id, EXCLUDED.attribution_id),
  basis_amount = CASE
    WHEN public.sales_program_accrual.status IN ('open', 'partially_settled')
      AND public.sales_program_accrual.settlement_id IS NULL
      AND COALESCE(public.sales_program_accrual.commission_amount, 0) <= 0
      THEN EXCLUDED.basis_amount
    ELSE public.sales_program_accrual.basis_amount
  END,
  discount_amount = CASE
    WHEN public.sales_program_accrual.status IN ('open', 'partially_settled')
      AND public.sales_program_accrual.settlement_id IS NULL
      AND COALESCE(public.sales_program_accrual.commission_amount, 0) <= 0
      THEN EXCLUDED.discount_amount
    ELSE public.sales_program_accrual.discount_amount
  END,
  commission_amount = CASE
    WHEN public.sales_program_accrual.status IN ('open', 'partially_settled')
      AND public.sales_program_accrual.settlement_id IS NULL
      AND COALESCE(public.sales_program_accrual.commission_amount, 0) <= 0
      THEN EXCLUDED.commission_amount
    ELSE public.sales_program_accrual.commission_amount
  END,
  metadata = public.sales_program_accrual.metadata || jsonb_build_object('rolling_cleanup_seen_at', now()),
  updated_at = now();

UPDATE public.reconciliation_case
SET
  status = 'resolved',
  close_code = 'moved_to_blue_bell_accrual_ledger',
  closed_at = COALESCE(closed_at, now()),
  evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
    'resolved_by_migration', '20260502113000_rolling_blue_bell_operations_cleanup',
    'reason', 'Unpaid Blue Bell commission is managed in the rolling Blue Bell accrual ledger, not the reconciliation inbox.'
  ),
  updated_at = now()
WHERE case_type = 'unpaid_program_accrual'
  AND status IN ('open', 'in_progress');

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
  ROUND(GREATEST(COALESCE(spa.commission_amount, 0) - COALESCE(spa.reversed_amount, 0), 0), 2) AS commission_outstanding,
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
WHERE sp.program_code = 'blue_bell'
  AND spa.accrual_type = 'commission'
  AND spa.status NOT IN ('settled', 'reversed', 'void');

CREATE OR REPLACE VIEW public.v_blue_bell_statement_export AS
SELECT *
FROM public.v_blue_bell_accrual_ledger
ORDER BY order_created_at DESC;

CREATE OR REPLACE VIEW public.v_blue_bell_monthly_statement_export AS
SELECT *
FROM public.v_blue_bell_statement_export;

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
  AND rc.case_type <> 'unpaid_program_accrual'
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
LEFT JOIN public.payouts p ON p.id = rc.payout_id
WHERE rc.case_type <> 'unpaid_program_accrual';

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
  WHERE case_type <> 'unpaid_program_accrual'
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
    COUNT(*) AS open_count,
    COALESCE(SUM(commission_outstanding), 0) AS outstanding_amount,
    MIN(created_at) AS oldest_open_at
  FROM public.v_blue_bell_accrual_ledger
  WHERE commission_outstanding > 0
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
    WHEN wr.open_count > 0 THEN 'Monitor marketplace or processor orders until payout evidence arrives.'
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
    WHEN lr.failed_count > 0 THEN 'Open failed listing commands, correct listing or channel data, then retry or cancel.'
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
    WHEN br.outstanding_amount > 0 THEN 'Settle unpaid Blue Bell commissions from the rolling accrual ledger.'
    ELSE 'No unpaid Blue Bell commission accruals.'
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

GRANT SELECT ON public.v_blue_bell_accrual_ledger TO authenticated;
GRANT SELECT ON public.v_blue_bell_statement_export TO authenticated;
GRANT SELECT ON public.v_blue_bell_monthly_statement_export TO authenticated;
GRANT SELECT ON public.v_reconciliation_inbox TO authenticated;
GRANT SELECT ON public.v_reconciliation_case_export TO authenticated;
GRANT SELECT ON public.v_subledger_operations_health TO authenticated;

COMMENT ON VIEW public.v_blue_bell_accrual_ledger IS
  'Rolling Blue Bell commission ledger. This is an operational unpaid/accrued commission view, not an accounting period close view.';

COMMENT ON VIEW public.v_subledger_operations_health IS
  'Rolling operations health with withheld payouts, reconciliation exceptions, outboxes, market refresh, QBO refresh drift, and Blue Bell unpaid commission. No period close KPI is included.';
