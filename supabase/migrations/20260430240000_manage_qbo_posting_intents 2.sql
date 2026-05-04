-- Add staff actions for retrying or cancelling QBO posting intents.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar quotes.

CREATE OR REPLACE FUNCTION public.retry_qbo_posting_intent(p_posting_intent_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_intent public.posting_intent%ROWTYPE;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to retry QBO posting intents'';
  END IF;

  SELECT * INTO v_intent
  FROM public.posting_intent
  WHERE id = p_posting_intent_id
    AND target_system = ''qbo'';

  IF NOT FOUND THEN
    RAISE EXCEPTION ''QBO posting intent % not found'', p_posting_intent_id;
  END IF;

  IF v_intent.status = ''processing'' THEN
    RAISE EXCEPTION ''Cannot retry QBO posting intent % while it is processing'', p_posting_intent_id;
  END IF;

  IF v_intent.status = ''posted'' THEN
    RAISE EXCEPTION ''Cannot retry QBO posting intent % after it has posted'', p_posting_intent_id;
  END IF;

  UPDATE public.posting_intent
  SET status = ''pending'',
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
  WHERE id = p_posting_intent_id;

  UPDATE public.reconciliation_case
  SET status = ''in_progress'',
      updated_at = now()
  WHERE case_type = ''qbo_posting_gap''
    AND related_entity_type = ''posting_intent''
    AND related_entity_id = p_posting_intent_id
    AND status = ''open'';

  RETURN p_posting_intent_id;
END;
';

CREATE OR REPLACE FUNCTION public.cancel_qbo_posting_intent(p_posting_intent_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_intent public.posting_intent%ROWTYPE;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to cancel QBO posting intents'';
  END IF;

  SELECT * INTO v_intent
  FROM public.posting_intent
  WHERE id = p_posting_intent_id
    AND target_system = ''qbo'';

  IF NOT FOUND THEN
    RAISE EXCEPTION ''QBO posting intent % not found'', p_posting_intent_id;
  END IF;

  IF v_intent.status = ''processing'' THEN
    RAISE EXCEPTION ''Cannot cancel QBO posting intent % while it is processing'', p_posting_intent_id;
  END IF;

  IF v_intent.status = ''posted'' THEN
    RAISE EXCEPTION ''Cannot cancel QBO posting intent % after it has posted'', p_posting_intent_id;
  END IF;

  UPDATE public.posting_intent
  SET status = ''cancelled'',
      next_attempt_at = NULL,
      updated_at = now()
  WHERE id = p_posting_intent_id;

  UPDATE public.reconciliation_case
  SET status = ''ignored'',
      close_code = ''cancelled_qbo_posting_intent'',
      closed_at = now(),
      updated_at = now()
  WHERE case_type = ''qbo_posting_gap''
    AND related_entity_type = ''posting_intent''
    AND related_entity_id = p_posting_intent_id
    AND status IN (''open'', ''in_progress'');

  RETURN p_posting_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.retry_qbo_posting_intent(UUID)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cancel_qbo_posting_intent(UUID)
TO authenticated, service_role;
