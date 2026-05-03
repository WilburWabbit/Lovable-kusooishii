-- Queue QBO customer upserts through the posting_intent outbox.
-- Lovable SQL runner note: keep PL/pgSQL bodies single-quoted, not dollar-quoted.

CREATE OR REPLACE FUNCTION public.queue_qbo_customer_posting_intent(
  p_customer_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_actor UUID := auth.uid();
  v_customer public.customer%ROWTYPE;
  v_entity_id UUID;
  v_idempotency_subject TEXT;
  v_intent_id UUID;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
    FROM public.customer
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION ''customer % not found'', p_customer_id;
    END IF;

    v_entity_id := p_customer_id;
    v_idempotency_subject := p_customer_id::text;
  ELSE
    v_idempotency_subject := COALESCE(v_actor::text, p_payload->>''email'', gen_random_uuid()::text);
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
    ''upsert_customer'',
    ''customer'',
    v_entity_id,
    ''qbo:upsert_customer:'' || v_idempotency_subject,
    ''pending'',
    COALESCE(p_payload, ''{}''::jsonb)
      || jsonb_build_object(
        ''customer_id'', p_customer_id,
        ''queued_by'', v_actor,
        ''queued_at'', now()
      )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      entity_id = COALESCE(EXCLUDED.entity_id, posting_intent.entity_id),
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

GRANT EXECUTE ON FUNCTION public.queue_qbo_customer_posting_intent(UUID, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.queue_qbo_customer_posting_intent(UUID, JSONB) IS
  'Queues an idempotent QBO Customer upsert intent for asynchronous processing.';
