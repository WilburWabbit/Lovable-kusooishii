ALTER TABLE public.reconciliation_case
  DROP CONSTRAINT IF EXISTS reconciliation_case_case_type_check;

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
    'other'
  )) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_outbound_command_failed_listing
  ON public.outbound_command(entity_type, entity_id, created_at)
  WHERE entity_type = 'channel_listing' AND status = 'failed';

CREATE OR REPLACE FUNCTION public.rebuild_listing_command_reconciliation_cases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.reconciliation_case (
    case_type, severity, related_entity_type, related_entity_id,
    suspected_root_cause, recommended_action, due_at, evidence
  )
  SELECT
    ''listing_command_failed'',
    CASE WHEN oc.command_type IN (''publish'', ''end'') THEN ''high'' ELSE ''medium'' END,
    ''outbound_command'',
    oc.id,
    ''Listing outbound command failed.'',
    ''Review the listing command error, correct listing/channel data, then rerun the listing outbox processor.'',
    COALESCE(oc.next_attempt_at, oc.updated_at, oc.created_at),
    jsonb_build_object(
      ''target_system'', oc.target_system,
      ''command_type'', oc.command_type,
      ''entity_type'', oc.entity_type,
      ''entity_id'', oc.entity_id,
      ''retry_count'', oc.retry_count,
      ''last_error'', oc.last_error,
      ''idempotency_key'', oc.idempotency_key,
      ''payload'', oc.payload
    )
  FROM public.outbound_command oc
  WHERE oc.entity_type = ''channel_listing''
    AND oc.status = ''failed''
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_case rc
      WHERE rc.case_type = ''listing_command_failed''
        AND rc.related_entity_type = ''outbound_command''
        AND rc.related_entity_id = oc.id
        AND rc.status IN (''open'', ''in_progress'')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.rebuild_listing_command_reconciliation_cases()
TO authenticated, service_role;