-- Queue QBO purchase create/update/delete through the posting_intent outbox.
-- Lovable SQL runner note: keep PL/pgSQL bodies single-quoted, not dollar-quoted.

CREATE OR REPLACE FUNCTION public.queue_qbo_purchase_posting_intent(
  p_batch_id UUID,
  p_action TEXT DEFAULT 'create_purchase'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_batch public.purchase_batches%ROWTYPE;
  v_action TEXT := COALESCE(NULLIF(trim(p_action), ''''), ''create_purchase'');
  v_intent_id UUID;
BEGIN
  IF v_action NOT IN (''create_purchase'', ''update_purchase'', ''delete_purchase'') THEN
    RAISE EXCEPTION ''unsupported QBO purchase action %'', v_action;
  END IF;

  SELECT * INTO v_batch
  FROM public.purchase_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''purchase batch % not found'', p_batch_id;
  END IF;

  IF v_action = ''create_purchase''
     AND v_batch.qbo_purchase_id IS NOT NULL
     AND COALESCE(v_batch.qbo_sync_status, '''') = ''synced'' THEN
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
    v_action,
    ''purchase_batch'',
    p_batch_id,
    ''qbo:'' || v_action || '':'' || p_batch_id::text,
    ''pending'',
    jsonb_build_object(
      ''batch_id'', p_batch_id,
      ''purchase_batch_id'', p_batch_id,
      ''reference'', v_batch.reference,
      ''supplier_name'', v_batch.supplier_name,
      ''qbo_purchase_id'', v_batch.qbo_purchase_id,
      ''queued_at'', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN ''pending''
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_purchase_posting_intent(UUID, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.queue_qbo_purchase_posting_intent(UUID, TEXT) IS
  'Queues an idempotent QBO Purchase posting intent for purchase batch create/update/delete processing.';
