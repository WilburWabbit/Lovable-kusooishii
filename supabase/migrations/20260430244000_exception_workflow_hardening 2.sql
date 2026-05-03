-- Harden reconciliation exception workflow with notes, assignment, SLA, and evidence gates.
-- Lovable SQL runner note: no dollar-quoted PL/pgSQL bodies in this file.

CREATE TABLE IF NOT EXISTS public.reconciliation_case_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_case_id UUID NOT NULL REFERENCES public.reconciliation_case(id) ON DELETE CASCADE,
  actor_id UUID,
  note_type TEXT NOT NULL DEFAULT 'operator_note'
    CHECK (note_type IN ('operator_note', 'status_change', 'assignment', 'due_date', 'resolution', 'system')),
  note TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_case_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reconciliation_case_note_staff_all" ON public.reconciliation_case_note
  FOR ALL TO authenticated USING (public.subledger_staff_read_policy()) WITH CHECK (public.subledger_staff_read_policy());

CREATE INDEX IF NOT EXISTS idx_reconciliation_case_note_case_created
  ON public.reconciliation_case_note(reconciliation_case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_case_owner_due
  ON public.reconciliation_case(owner_id, due_at, status)
  WHERE status IN ('open', 'in_progress');

CREATE OR REPLACE FUNCTION public.reconciliation_case_requires_evidence(p_case_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS '
  SELECT p_case_type IN (
    ''missing_cogs'',
    ''unmatched_payout_fee'',
    ''missing_payout'',
    ''amount_mismatch'',
    ''unpaid_program_accrual'',
    ''qbo_posting_gap''
  );
';

CREATE OR REPLACE FUNCTION public.update_reconciliation_case_workflow(
  p_case_id UUID,
  p_status TEXT DEFAULT NULL,
  p_owner_id UUID DEFAULT NULL,
  p_due_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_evidence JSONB DEFAULT '{}'::jsonb,
  p_clear_owner BOOLEAN DEFAULT false,
  p_clear_due_at BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_actor UUID := auth.uid();
  v_case public.reconciliation_case%ROWTYPE;
  v_note_type TEXT := ''operator_note'';
  v_note TEXT := NULLIF(trim(COALESCE(p_note, '''')), '''');
  v_evidence JSONB := COALESCE(p_evidence, ''{}''::jsonb);
  v_next_status TEXT;
  v_next_owner UUID;
  v_next_due_at TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO v_case
  FROM public.reconciliation_case
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Reconciliation case % not found'', p_case_id;
  END IF;

  IF p_status IS NOT NULL
    AND p_status NOT IN (''open'', ''in_progress'', ''resolved'', ''ignored'') THEN
    RAISE EXCEPTION ''Unsupported reconciliation status: %'', p_status;
  END IF;

  IF p_status IN (''resolved'', ''ignored'')
    AND public.reconciliation_case_requires_evidence(v_case.case_type)
    AND v_note IS NULL
    AND v_evidence = ''{}''::jsonb THEN
    RAISE EXCEPTION ''Finance-sensitive case % requires a resolution note or evidence before it can be closed'', p_case_id;
  END IF;

  v_next_status := COALESCE(p_status, v_case.status);
  v_next_owner := CASE WHEN p_clear_owner THEN NULL WHEN p_owner_id IS NOT NULL THEN p_owner_id ELSE v_case.owner_id END;
  v_next_due_at := CASE WHEN p_clear_due_at THEN NULL WHEN p_due_at IS NOT NULL THEN p_due_at ELSE v_case.due_at END;

  UPDATE public.reconciliation_case
  SET status = v_next_status,
      owner_id = v_next_owner,
      due_at = v_next_due_at,
      close_code = CASE
        WHEN p_status = ''resolved'' THEN ''resolved_with_evidence''
        WHEN p_status = ''ignored'' THEN ''ignored_with_evidence''
        WHEN p_status IN (''open'', ''in_progress'') THEN NULL
        ELSE close_code
      END,
      closed_at = CASE
        WHEN p_status IN (''resolved'', ''ignored'') THEN now()
        WHEN p_status IN (''open'', ''in_progress'') THEN NULL
        ELSE closed_at
      END,
      evidence = CASE WHEN v_evidence <> ''{}''::jsonb THEN evidence || jsonb_build_object(''operator_evidence'', v_evidence, ''operator_evidence_at'', now()) ELSE evidence END,
      updated_at = now()
  WHERE id = p_case_id;

  IF p_status IN (''resolved'', ''ignored'') THEN
    v_note_type := ''resolution'';
  ELSIF p_status IS NOT NULL THEN
    v_note_type := ''status_change'';
  ELSIF p_owner_id IS NOT NULL OR p_clear_owner THEN
    v_note_type := ''assignment'';
  ELSIF p_due_at IS NOT NULL OR p_clear_due_at THEN
    v_note_type := ''due_date'';
  END IF;

  IF v_note IS NOT NULL
    OR v_evidence <> ''{}''::jsonb
    OR p_status IS NOT NULL
    OR p_owner_id IS NOT NULL
    OR p_due_at IS NOT NULL
    OR p_clear_owner
    OR p_clear_due_at THEN
    INSERT INTO public.reconciliation_case_note (
      reconciliation_case_id,
      actor_id,
      note_type,
      note,
      evidence
    )
    VALUES (
      p_case_id,
      v_actor,
      v_note_type,
      COALESCE(v_note, concat(''Workflow update: '', v_note_type)),
      v_evidence || jsonb_build_object(
        ''status'', v_next_status,
        ''owner_id'', v_next_owner,
        ''due_at'', v_next_due_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    ''success'', true,
    ''case_id'', p_case_id,
    ''status'', v_next_status,
    ''owner_id'', v_next_owner,
    ''due_at'', v_next_due_at
  );
END;
';

CREATE OR REPLACE FUNCTION public.bulk_update_reconciliation_case_workflow(
  p_case_ids UUID[],
  p_status TEXT DEFAULT NULL,
  p_owner_id UUID DEFAULT NULL,
  p_due_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_evidence JSONB DEFAULT '{}'::jsonb,
  p_clear_owner BOOLEAN DEFAULT false,
  p_clear_due_at BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_case_id UUID;
  v_count INTEGER := 0;
  v_errors JSONB := ''[]''::jsonb;
BEGIN
  IF p_case_ids IS NULL OR array_length(p_case_ids, 1) IS NULL THEN
    RAISE EXCEPTION ''At least one case id is required'';
  END IF;

  FOREACH v_case_id IN ARRAY p_case_ids LOOP
    BEGIN
      PERFORM public.update_reconciliation_case_workflow(
        v_case_id,
        p_status,
        p_owner_id,
        p_due_at,
        p_note,
        p_evidence,
        p_clear_owner,
        p_clear_due_at
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(''case_id'', v_case_id, ''error'', SQLERRM));
    END;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 AND v_count = 0 THEN
    RAISE EXCEPTION ''Bulk case update failed: %'', v_errors::text;
  END IF;

  RETURN jsonb_build_object(''success'', true, ''updated'', v_count, ''errors'', v_errors);
END;
';

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
