CREATE OR REPLACE FUNCTION public.queue_qbo_posting_intents_for_order(p_sales_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS 'DECLARE
  v_order public.sales_order%ROWTYPE;
  v_customer_qbo_id TEXT;
  v_customer_intent_id UUID;
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order % not found'', p_sales_order_id;
  END IF;

  IF v_order.qbo_sales_receipt_id IS NOT NULL THEN
    PERFORM public.record_order_accounting_events(p_sales_order_id, ''posting_intent_existing_qbo_reference'');
    PERFORM public.refresh_order_settlement_lines(p_sales_order_id, false);
    RETURN 0;
  END IF;

  PERFORM public.record_order_accounting_events(p_sales_order_id, ''posting_intent_queue'');
  PERFORM public.refresh_order_settlement_lines(p_sales_order_id, false);

  IF v_order.customer_id IS NOT NULL AND v_order.qbo_customer_id IS NULL THEN
    SELECT qbo_customer_id INTO v_customer_qbo_id
    FROM public.customer
    WHERE id = v_order.customer_id;

    IF v_customer_qbo_id IS NULL THEN
      SELECT public.queue_qbo_customer_posting_intent(
        v_order.customer_id,
        jsonb_build_object(
          ''customer_id'', v_order.customer_id,
          ''sales_order_id'', p_sales_order_id,
          ''dependency_for'', ''create_sales_receipt'',
          ''origin'', ''queue_qbo_posting_intents_for_order''
        )
      ) INTO v_customer_intent_id;

      IF v_customer_intent_id IS NOT NULL THEN
        v_count := v_count + 1;
      END IF;
    ELSE
      UPDATE public.sales_order
      SET qbo_customer_id = v_customer_qbo_id
      WHERE id = p_sales_order_id
        AND qbo_customer_id IS NULL;
    END IF;
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
    ''create_sales_receipt'',
    ''sales_order'',
    p_sales_order_id,
    ''qbo:create_sales_receipt:'' || p_sales_order_id::text,
    ''pending'',
    jsonb_build_object(
      ''sales_order_id'', p_sales_order_id,
      ''order_number'', v_order.order_number,
      ''gross_total'', v_order.gross_total,
      ''currency'', v_order.currency,
      ''customer_id'', v_order.customer_id,
      ''requires_qbo_customer'', v_order.customer_id IS NOT NULL,
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
      updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;
  RETURN v_count;
END;';

GRANT EXECUTE ON FUNCTION public.queue_qbo_posting_intents_for_order(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.queue_qbo_posting_intents_for_order(UUID) IS
  'Records order accounting events and queues QBO customer dependencies before sales receipt posting.';