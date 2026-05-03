-- ===== Migration 1 (continued): views and grants =====

CREATE OR REPLACE VIEW public.v_reconciliation_case_note AS
SELECT
  n.id,
  n.reconciliation_case_id,
  n.actor_id,
  COALESCE(p.display_name, n.actor_id::text) AS actor_name,
  n.note_type,
  n.note,
  n.evidence,
  n.created_at
FROM public.reconciliation_case_note n
LEFT JOIN public.profile p ON p.user_id = n.actor_id
ORDER BY n.created_at DESC;

CREATE OR REPLACE VIEW public.v_reconciliation_case_owner AS
SELECT DISTINCT
  ur.user_id,
  COALESCE(p.display_name, ur.user_id::text) AS display_name,
  array_agg(DISTINCT ur.role ORDER BY ur.role) AS roles
FROM public.user_roles ur
LEFT JOIN public.profile p ON p.user_id = ur.user_id
WHERE ur.role IN ('admin', 'staff')
GROUP BY ur.user_id, COALESCE(p.display_name, ur.user_id::text)
ORDER BY display_name;

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
  rc.owner_id,
  rc.due_at,
  rc.created_at,
  rc.updated_at,
  so.origin_channel,
  sol.sku_id,
  sk.sku_code,
  p.external_payout_id,
  p.channel::text AS payout_channel,
  rc.evidence,
  CASE
    WHEN rc.case_type = 'missing_cogs' THEN 'No cost basis has been posted for this sold line. Usually the sale line was finalized before stock allocation or before carrying value existed.'
    WHEN rc.case_type = 'unallocated_order_line' THEN 'The order line has no allocated stock unit, so COGS and final accounting are blocked.'
    WHEN rc.case_type = 'unmatched_payout_fee' THEN 'A payout fee exists but is not linked to a canonical sales order. The external order reference may be missing, malformed, duplicated, or not yet imported.'
    WHEN rc.case_type = 'missing_payout' THEN 'Expected settlement exists for the order but no actual payout evidence has been imported or matched inside the SLA window.'
    WHEN rc.case_type = 'amount_mismatch' THEN 'Expected settlement and actual payout evidence differ beyond tolerance. Common causes are fee timing, partial refunds, shipping adjustments, marketplace holds, or duplicate actual lines.'
    WHEN rc.case_type = 'unpaid_program_accrual' THEN 'A sales-program commission accrual is open past its expected settlement date.'
    WHEN rc.case_type = 'qbo_posting_gap' THEN 'The app has expected accounting events but no successful QBO posting reference.'
    WHEN rc.case_type = 'listing_command_failed' THEN 'An outbound listing command failed or exhausted retries before the external channel acknowledged it.'
    WHEN rc.case_type = 'duplicate_candidate' THEN 'More than one possible match exists. Automatic reconciliation is paused to avoid joining the wrong records.'
    ELSE COALESCE(rc.suspected_root_cause, 'No detailed diagnosis has been recorded yet.')
  END AS diagnosis,
  CASE
    WHEN rc.case_type = 'missing_cogs' THEN 'Allocate or correct the stock unit for the line, confirm carrying value, then refresh order economics and rebuild reconciliation cases.'
    WHEN rc.case_type = 'unallocated_order_line' THEN 'Open the order, allocate a saleable stock unit, then refresh order economics. If no stock exists, purchase/grade stock or mark the line as a manual exception.'
    WHEN rc.case_type = 'unmatched_payout_fee' THEN 'Use Link to match by external order ID. If it does not match, inspect payout_fee external references and import the missing order first.'
    WHEN rc.case_type = 'missing_payout' THEN 'Run settlement refresh. If still missing, import the Stripe/eBay payout or confirm the marketplace has not paid it yet.'
    WHEN rc.case_type = 'amount_mismatch' THEN 'Compare expected versus actual amounts in the export, inspect fee/refund lines, then refresh settlement after correcting the source evidence.'
    WHEN rc.case_type = 'unpaid_program_accrual' THEN 'Create the monthly Blue Bell settlement, mark the payment once made, then rebuild reconciliation cases.'
    WHEN rc.case_type = 'qbo_posting_gap' THEN 'Queue or retry the QBO posting intent. If it fails again, inspect the posting error and source entity data.'
    WHEN rc.case_type = 'listing_command_failed' THEN 'Open the listing command, fix the channel/listing data named in the error, then retry the command.'
    WHEN rc.case_type = 'duplicate_candidate' THEN 'Review candidates in the evidence payload and choose the correct order/payout link manually.'
    ELSE COALESCE(rc.recommended_action, 'Review the evidence payload and related records, then resolve or ignore with a note.')
  END AS next_step,
  public.reconciliation_case_requires_evidence(rc.case_type) AS requires_evidence,
  COALESCE(owner.display_name, rc.owner_id::text) AS owner_name,
  COALESCE(nr.note_count, 0) AS note_count,
  nr.latest_note_at,
  nr.latest_note,
  CASE
    WHEN rc.due_at IS NULL THEN 'no_due_date'
    WHEN rc.due_at < now() THEN 'overdue'
    WHEN rc.due_at < now() + interval '24 hours' THEN 'due_soon'
    ELSE 'scheduled'
  END AS sla_status
FROM public.reconciliation_case rc
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
LEFT JOIN public.sales_order_line sol ON sol.id = rc.sales_order_line_id
LEFT JOIN public.sku sk ON sk.id = sol.sku_id
LEFT JOIN public.payouts p ON p.id = rc.payout_id
LEFT JOIN public.v_reconciliation_case_owner owner ON owner.user_id = rc.owner_id
LEFT JOIN note_rollup nr ON nr.reconciliation_case_id = rc.id
WHERE rc.status IN ('open', 'in_progress')
ORDER BY
  CASE rc.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  CASE
    WHEN rc.due_at IS NOT NULL AND rc.due_at < now() THEN 0
    WHEN rc.due_at IS NOT NULL AND rc.due_at < now() + interval '24 hours' THEN 1
    ELSE 2
  END,
  rc.created_at ASC;

CREATE OR REPLACE VIEW public.v_reconciliation_case_export AS
SELECT
  rc.id,
  rc.case_type,
  rc.severity,
  rc.status,
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
  rc.due_at,
  rc.created_at,
  rc.updated_at,
  rc.closed_at,
  rc.close_code,
  rc.owner_id,
  inbox.owner_name,
  inbox.sla_status,
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

GRANT EXECUTE ON FUNCTION public.reconciliation_case_requires_evidence(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_reconciliation_case_workflow(UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_update_reconciliation_case_workflow(UUID[], TEXT, UUID, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, BOOLEAN) TO authenticated, service_role;
GRANT SELECT ON public.v_reconciliation_case_note TO authenticated;
GRANT SELECT ON public.v_reconciliation_case_owner TO authenticated;
GRANT SELECT ON public.v_reconciliation_inbox TO authenticated;
GRANT SELECT ON public.v_reconciliation_case_export TO authenticated;
