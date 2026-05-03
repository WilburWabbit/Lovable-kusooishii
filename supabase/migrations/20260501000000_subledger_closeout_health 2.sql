-- Final close-out observability for the commerce subledger build.
-- Lovable-safe SQL: no dollar-quoted function bodies.

CREATE OR REPLACE VIEW public.v_subledger_job_run AS
SELECT
  ae.id,
  ae.occurred_at,
  ae.actor_type,
  ae.actor_id,
  ae.after_json->>'requested_job' AS requested_job,
  NULLIF(ae.after_json->>'success', '')::BOOLEAN AS run_success,
  job_result.value->>'job' AS job,
  NULLIF(job_result.value->>'success', '')::BOOLEAN AS job_success,
  NULLIF(job_result.value->>'rows', '')::INTEGER AS rows_processed,
  job_result.value->>'error' AS error,
  job_result.value->'response' AS response
FROM public.audit_event ae
LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ae.after_json->'results', '[]'::jsonb)) AS job_result(value)
  ON true
WHERE ae.entity_type = 'scheduled_job'
  AND ae.trigger_type = 'subledger_scheduled_jobs';

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
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_at < now()) AS overdue_count,
    MIN(created_at) FILTER (WHERE status IN ('open', 'in_progress')) AS oldest_open_at
  FROM public.reconciliation_case
),
qbo_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '30 minutes') AS overdue_count,
    MIN(created_at) FILTER (WHERE status IN ('pending', 'failed', 'processing')) AS oldest_pending_at
  FROM public.posting_intent
  WHERE target_system = 'qbo'
),
listing_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '30 minutes') AS overdue_count,
    MIN(created_at) FILTER (WHERE status IN ('pending', 'failed', 'processing')) AS oldest_pending_at
  FROM public.outbound_command
  WHERE entity_type = 'channel_listing'
),
settlement_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE close_status = 'blocked') AS blocked_count,
    COUNT(*) FILTER (WHERE close_status = 'review') AS review_count,
    MAX(period_end) FILTER (WHERE close_status = 'ready') AS last_ready_period_end
  FROM public.v_settlement_period_close
),
blue_bell_rollup AS (
  SELECT
    COUNT(*) FILTER (WHERE spa.status IN ('open', 'partially_settled')) AS open_count,
    COALESCE(SUM(spa.commission_amount - COALESCE(spa.reversed_amount, 0)) FILTER (WHERE spa.status IN ('open', 'partially_settled')), 0) AS outstanding_amount,
    MIN(spa.created_at) FILTER (WHERE spa.status IN ('open', 'partially_settled')) AS oldest_open_at
  FROM public.sales_program_accrual spa
  JOIN public.sales_program sp ON sp.id = spa.sales_program_id
  WHERE sp.program_code = 'blue_bell'
),
market_rollup AS (
  SELECT
    COUNT(*) AS snapshot_count,
    COUNT(*) FILTER (WHERE captured_at < now() - interval '14 days') AS stale_count,
    MAX(captured_at) AS latest_snapshot_at
  FROM public.market_price_snapshot
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
  CASE
    WHEN cr.overdue_count > 0 OR cr.high_count > 0 THEN 'blocked'
    WHEN cr.open_count > 0 THEN 'warning'
    ELSE 'ready'
  END AS health_status,
  CASE
    WHEN cr.overdue_count > 0 OR cr.high_count > 0 THEN 'high'
    WHEN cr.open_count > 0 THEN 'medium'
    ELSE 'low'
  END AS severity,
  cr.open_count,
  cr.high_count AS failed_count,
  0::BIGINT AS pending_count,
  cr.overdue_count,
  (SELECT last_success_at FROM job_rollup WHERE job = 'settlement_reconciliation') AS last_success_at,
  (SELECT last_failure_at FROM job_rollup WHERE job = 'settlement_reconciliation') AS last_failure_at,
  cr.oldest_open_at AS oldest_pending_at,
  CASE
    WHEN cr.overdue_count > 0 THEN 'Resolve or reassign overdue reconciliation cases before period close.'
    WHEN cr.high_count > 0 THEN 'Triage high-severity finance or listing exceptions first.'
    WHEN cr.open_count > 0 THEN 'Work through open cases or record why they are safe to ignore.'
    ELSE 'No open reconciliation cases.'
  END AS recommendation
FROM case_rollup cr

UNION ALL

SELECT
  'qbo_posting_outbox',
  CASE
    WHEN qr.failed_count > 0 OR qr.overdue_count > 0 THEN 'blocked'
    WHEN qr.pending_count > 0 THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN qr.failed_count > 0 OR qr.overdue_count > 0 THEN 'high'
    WHEN qr.pending_count > 0 THEN 'medium'
    ELSE 'low'
  END,
  0::BIGINT,
  qr.failed_count,
  qr.pending_count,
  qr.overdue_count,
  (SELECT last_success_at FROM job_rollup WHERE job = 'qbo_posting_outbox'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'qbo_posting_outbox'),
  qr.oldest_pending_at,
  CASE
    WHEN qr.failed_count > 0 THEN 'Open failed QBO posting intents, fix the error, then retry or cancel with evidence.'
    WHEN qr.overdue_count > 0 THEN 'A QBO posting intent appears stuck in processing; review the edge function logs and retry.'
    WHEN qr.pending_count > 0 THEN 'Run the QBO posting outbox processor.'
    ELSE 'QBO posting outbox is clear.'
  END
FROM qbo_rollup qr

UNION ALL

SELECT
  'listing_command_outbox',
  CASE
    WHEN lr.failed_count > 0 OR lr.overdue_count > 0 THEN 'blocked'
    WHEN lr.pending_count > 0 THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN lr.failed_count > 0 OR lr.overdue_count > 0 THEN 'high'
    WHEN lr.pending_count > 0 THEN 'medium'
    ELSE 'low'
  END,
  0::BIGINT,
  lr.failed_count,
  lr.pending_count,
  lr.overdue_count,
  (SELECT last_success_at FROM job_rollup WHERE job = 'listing_outbox'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'listing_outbox'),
  lr.oldest_pending_at,
  CASE
    WHEN lr.failed_count > 0 THEN 'Open failed listing commands, correct listing/channel data, then retry or cancel.'
    WHEN lr.overdue_count > 0 THEN 'A listing command appears stuck in processing; review channel logs and retry.'
    WHEN lr.pending_count > 0 THEN 'Run the listing outbox processor.'
    ELSE 'Listing command outbox is clear.'
  END
FROM listing_rollup lr

UNION ALL

SELECT
  'settlement_close',
  CASE
    WHEN sr.blocked_count > 0 THEN 'blocked'
    WHEN sr.review_count > 0 THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN sr.blocked_count > 0 THEN 'high'
    WHEN sr.review_count > 0 THEN 'medium'
    ELSE 'low'
  END,
  sr.blocked_count + sr.review_count,
  sr.blocked_count,
  sr.review_count,
  0::BIGINT,
  (SELECT last_success_at FROM job_rollup WHERE job = 'settlement_reconciliation'),
  (SELECT last_failure_at FROM job_rollup WHERE job = 'settlement_reconciliation'),
  NULL::TIMESTAMPTZ,
  CASE
    WHEN sr.blocked_count > 0 THEN 'Resolve blocked settlement periods before close.'
    WHEN sr.review_count > 0 THEN 'Review settlement periods with variance or missing payout evidence.'
    ELSE 'Settlement periods are ready or already clear.'
  END
FROM settlement_rollup sr

UNION ALL

SELECT
  'blue_bell_accruals',
  CASE
    WHEN br.outstanding_amount > 0 THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN br.outstanding_amount > 0 THEN 'medium'
    ELSE 'low'
  END,
  br.open_count,
  0::BIGINT,
  br.open_count,
  0::BIGINT,
  NULL::TIMESTAMPTZ,
  NULL::TIMESTAMPTZ,
  br.oldest_open_at,
  CASE
    WHEN br.outstanding_amount > 0 THEN 'Create Blue Bell settlement statements for open accrual periods.'
    ELSE 'No open Blue Bell accruals.'
  END
FROM blue_bell_rollup br

UNION ALL

SELECT
  'market_intelligence',
  CASE
    WHEN mr.snapshot_count = 0 THEN 'warning'
    WHEN mr.latest_snapshot_at < now() - interval '14 days' THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN mr.snapshot_count = 0 OR mr.latest_snapshot_at < now() - interval '14 days' THEN 'medium'
    ELSE 'low'
  END,
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
  'scheduled_automation',
  CASE
    WHEN sr.recent_failure_count > 0 THEN 'blocked'
    WHEN sr.last_success_at IS NULL THEN 'warning'
    ELSE 'ready'
  END,
  CASE
    WHEN sr.recent_failure_count > 0 THEN 'high'
    WHEN sr.last_success_at IS NULL THEN 'medium'
    ELSE 'low'
  END,
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

GRANT SELECT ON public.v_subledger_job_run TO authenticated;
GRANT SELECT ON public.v_subledger_operations_health TO authenticated;

COMMENT ON VIEW public.v_subledger_job_run IS
  'Flattened audit trail for subledger scheduled job runs.';
COMMENT ON VIEW public.v_subledger_operations_health IS
  'Operational close-out health summary for reconciliation, outboxes, settlement, Blue Bell, market intelligence, and scheduled automation.';
