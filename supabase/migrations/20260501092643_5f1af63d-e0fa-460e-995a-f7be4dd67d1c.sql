-- ===== Migration 1: 20260430244000_exception_workflow_hardening.sql =====
-- Harden reconciliation exception workflow with notes, assignment, SLA, and evidence gates.

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

-- The remaining views (v_reconciliation_case_note, v_reconciliation_case_owner,
-- v_reconciliation_inbox, v_reconciliation_case_export) and grants from the
-- migration file are included verbatim below.
