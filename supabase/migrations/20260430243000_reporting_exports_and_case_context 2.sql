-- Reporting/export surfaces and richer reconciliation inbox context.
-- Lovable SQL runner note: no dollar-quoted PL/pgSQL bodies in this file.

CREATE OR REPLACE VIEW public.v_reconciliation_inbox AS
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
  END AS next_step
FROM public.reconciliation_case rc
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
LEFT JOIN public.sales_order_line sol ON sol.id = rc.sales_order_line_id
LEFT JOIN public.sku sk ON sk.id = sol.sku_id
LEFT JOIN public.payouts p ON p.id = rc.payout_id
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
  rc.close_code
FROM public.reconciliation_case rc
LEFT JOIN public.v_reconciliation_inbox inbox ON inbox.id = rc.id
LEFT JOIN public.sales_order so ON so.id = rc.sales_order_id
LEFT JOIN public.sales_order_line sol ON sol.id = rc.sales_order_line_id
LEFT JOIN public.sku sk ON sk.id = sol.sku_id
LEFT JOIN public.payouts p ON p.id = rc.payout_id;

CREATE OR REPLACE VIEW public.v_settlement_close_export AS
SELECT
  s.period_start,
  s.period_end,
  s.channel,
  s.order_count,
  s.expected_gross,
  s.expected_shipping,
  s.expected_tax,
  s.expected_discount,
  s.expected_fees,
  s.expected_commission,
  s.expected_total,
  s.actual_gross,
  s.actual_shipping,
  s.actual_fees,
  s.actual_refunds,
  s.actual_total,
  s.variance_amount,
  s.payout_count,
  s.payout_gross,
  s.payout_fees,
  s.payout_net,
  s.unreconciled_payout_count,
  s.open_case_count,
  s.missing_payout_case_count,
  s.amount_mismatch_case_count,
  c.close_status
FROM public.v_settlement_period_summary s
JOIN public.v_settlement_period_close c
  ON c.period_start = s.period_start
 AND c.period_end = s.period_end
ORDER BY s.period_start DESC, s.channel;

CREATE OR REPLACE VIEW public.v_blue_bell_monthly_statement_export AS
SELECT
  date_trunc('month', so.created_at)::date AS period_start,
  (date_trunc('month', so.created_at) + interval '1 month - 1 day')::date AS period_end,
  so.order_number,
  so.created_at::date AS order_date,
  so.origin_channel,
  spa.status,
  ROUND(COALESCE(spa.basis_amount, 0), 2) AS basis_amount,
  ROUND(COALESCE(spa.discount_amount, 0), 2) AS discount_amount,
  ROUND(COALESCE(spa.commission_amount, 0), 2) AS commission_amount,
  ROUND(COALESCE(spa.reversed_amount, 0), 2) AS reversed_amount,
  ROUND(COALESCE(spa.commission_amount, 0) - COALESCE(spa.reversed_amount, 0), 2) AS net_commission_amount,
  spa.settlement_id,
  s.status AS settlement_status,
  s.updated_at AS settlement_updated_at,
  spa.created_at AS accrual_created_at
FROM public.sales_program_accrual spa
JOIN public.sales_program sp ON sp.id = spa.sales_program_id
JOIN public.sales_order so ON so.id = spa.sales_order_id
LEFT JOIN public.sales_program_settlement s ON s.id = spa.settlement_id
WHERE sp.program_code = 'blue_bell'
ORDER BY period_start DESC, so.created_at DESC;

CREATE OR REPLACE VIEW public.v_margin_profit_report AS
SELECT
  up.stock_unit_id,
  up.uid,
  up.sku,
  sk.mpn,
  p.name AS product_name,
  up.v2_status,
  so.order_number,
  so.origin_channel,
  so.created_at::date AS order_date,
  date_trunc('month', so.created_at)::date AS period_start,
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
ORDER BY so.created_at DESC NULLS LAST, up.sku;

GRANT SELECT ON public.v_reconciliation_inbox TO authenticated;
GRANT SELECT ON public.v_reconciliation_case_export TO authenticated;
GRANT SELECT ON public.v_settlement_close_export TO authenticated;
GRANT SELECT ON public.v_blue_bell_monthly_statement_export TO authenticated;
GRANT SELECT ON public.v_margin_profit_report TO authenticated;
