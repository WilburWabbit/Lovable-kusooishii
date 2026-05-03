-- Add staff actions for retrying or cancelling listing outbox commands.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar quotes.

CREATE OR REPLACE FUNCTION public.retry_listing_outbound_command(p_outbound_command_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_command public.outbound_command%ROWTYPE;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to retry listing commands'';
  END IF;

  SELECT * INTO v_command
  FROM public.outbound_command
  WHERE id = p_outbound_command_id
    AND entity_type = ''channel_listing'';

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Listing outbound command % not found'', p_outbound_command_id;
  END IF;

  IF v_command.status = ''processing'' THEN
    RAISE EXCEPTION ''Cannot retry listing command % while it is processing'', p_outbound_command_id;
  END IF;

  IF v_command.status IN (''acknowledged'', ''sent'') THEN
    RAISE EXCEPTION ''Cannot retry listing command % after it has been sent'', p_outbound_command_id;
  END IF;

  UPDATE public.outbound_command
  SET status = ''pending'',
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
  WHERE id = p_outbound_command_id;

  UPDATE public.reconciliation_case
  SET status = ''resolved'',
      close_code = ''retried_listing_command'',
      closed_at = now(),
      updated_at = now()
  WHERE case_type = ''listing_command_failed''
    AND related_entity_type = ''outbound_command''
    AND related_entity_id = p_outbound_command_id
    AND status IN (''open'', ''in_progress'');

  RETURN p_outbound_command_id;
END;
';

CREATE OR REPLACE FUNCTION public.cancel_listing_outbound_command(p_outbound_command_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_command public.outbound_command%ROWTYPE;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to cancel listing commands'';
  END IF;

  SELECT * INTO v_command
  FROM public.outbound_command
  WHERE id = p_outbound_command_id
    AND entity_type = ''channel_listing'';

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Listing outbound command % not found'', p_outbound_command_id;
  END IF;

  IF v_command.status IN (''acknowledged'', ''sent'') THEN
    RAISE EXCEPTION ''Cannot cancel listing command % after it has been sent'', p_outbound_command_id;
  END IF;

  IF v_command.status = ''processing'' THEN
    RAISE EXCEPTION ''Cannot cancel listing command % while it is processing'', p_outbound_command_id;
  END IF;

  UPDATE public.outbound_command
  SET status = ''cancelled'',
      next_attempt_at = NULL,
      updated_at = now()
  WHERE id = p_outbound_command_id;

  UPDATE public.reconciliation_case
  SET status = ''ignored'',
      close_code = ''cancelled_listing_command'',
      closed_at = now(),
      updated_at = now()
  WHERE case_type = ''listing_command_failed''
    AND related_entity_type = ''outbound_command''
    AND related_entity_id = p_outbound_command_id
    AND status IN (''open'', ''in_progress'');

  RETURN p_outbound_command_id;
END;
';

GRANT EXECUTE ON FUNCTION public.retry_listing_outbound_command(UUID)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cancel_listing_outbound_command(UUID)
TO authenticated, service_role;
