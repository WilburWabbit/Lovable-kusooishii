-- Queue QBO payout/deposit posting through the posting_intent outbox.
-- Lovable SQL runner note: keep PL/pgSQL bodies single-quoted, not dollar-quoted.

CREATE OR REPLACE FUNCTION public.queue_qbo_payout_posting_intent(p_payout_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_payout public.payouts%ROWTYPE;
  v_intent_id UUID;
BEGIN
  SELECT * INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''payout % not found'', p_payout_id;
  END IF;

  IF v_payout.qbo_deposit_id IS NOT NULL
     AND COALESCE(v_payout.qbo_sync_status, '''') = ''synced'' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.posting_intent (
    target_system,
    action,
    entity_type,
    entity_id,
    idempotency_key,
    status,
    payload
  )
  VALUES (
    ''qbo'',
    ''create_payout_deposit'',
    ''payout'',
    p_payout_id,
    ''qbo:create_payout_deposit:'' || p_payout_id::text,
    ''pending'',
    jsonb_build_object(
      ''payout_id'', p_payout_id,
      ''external_payout_id'', v_payout.external_payout_id,
      ''channel'', v_payout.channel,
      ''net_amount'', v_payout.net_amount,
      ''currency'', ''GBP'',
      ''queued_at'', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'') THEN ''pending''
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_payout_posting_intent(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.queue_qbo_payout_posting_intent(UUID) IS
  'Queues an idempotent QBO payout/deposit posting intent for asynchronous processing.';
