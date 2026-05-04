CREATE OR REPLACE FUNCTION public.refresh_order_settlement_lines(
  p_sales_order_id UUID,
  p_rebuild_cases BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS 'DECLARE
  v_order public.sales_order%ROWTYPE;
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order % not found'', p_sales_order_id;
  END IF;

  DELETE FROM public.expected_settlement_line
  WHERE sales_order_id = p_sales_order_id
    AND category IN (''discount'', ''shipping'', ''tax'')
    AND source IN (''sales_order'', ''order_economics'');

  INSERT INTO public.expected_settlement_line (
    sales_order_id,
    category,
    amount,
    currency,
    source,
    confidence,
    idempotency_key,
    metadata,
    created_at
  )
  SELECT v_order.id, ''gross'', COALESCE(v_order.gross_total, 0),
         COALESCE(v_order.currency, ''GBP''), ''sales_order'', ''actual'',
         ''expected:gross:'' || v_order.id::text,
         jsonb_build_object(''origin_channel'', v_order.origin_channel),
         COALESCE(v_order.created_at, now())
  WHERE COALESCE(v_order.gross_total, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      confidence = EXCLUDED.confidence,
      metadata = EXCLUDED.metadata;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.expected_settlement_line (
    sales_order_id,
    category,
    amount,
    currency,
    source,
    confidence,
    idempotency_key,
    metadata,
    created_at
  )
  SELECT pf.sales_order_id, ''fee'', -ABS(SUM(pf.amount)),
         COALESCE(v_order.currency, ''GBP''), ''payout_fee'', ''actual'',
         ''expected:fee:'' || pf.sales_order_id::text,
         jsonb_build_object(''source'', ''payout_fee'', ''payout_fee_count'', COUNT(*)),
         MIN(pf.created_at)
  FROM public.payout_fee pf
  WHERE pf.sales_order_id = p_sales_order_id
  GROUP BY pf.sales_order_id
  HAVING SUM(pf.amount) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      confidence = EXCLUDED.confidence,
      metadata = EXCLUDED.metadata;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.expected_settlement_line (
    sales_order_id,
    sales_program_accrual_id,
    category,
    amount,
    currency,
    source,
    confidence,
    idempotency_key,
    metadata,
    created_at
  )
  SELECT spa.sales_order_id, spa.id, ''commission'',
         -ABS(spa.commission_amount - spa.reversed_amount),
         spa.currency, ''sales_program_accrual'', ''actual'',
         ''expected:program_commission:'' || spa.id::text,
         jsonb_build_object(''sales_program_id'', spa.sales_program_id),
         spa.created_at
  FROM public.sales_program_accrual spa
  WHERE spa.sales_order_id = p_sales_order_id
    AND spa.accrual_type = ''commission''
    AND spa.commission_amount - spa.reversed_amount <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      confidence = EXCLUDED.confidence,
      metadata = EXCLUDED.metadata,
      sales_program_accrual_id = EXCLUDED.sales_program_accrual_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.actual_settlement_line (
    payout_id,
    sales_order_id,
    source_system,
    category,
    amount,
    currency,
    external_reference,
    idempotency_key,
    metadata,
    occurred_at
  )
  SELECT po.payout_id,
         po.sales_order_id,
         COALESCE(p.channel::text, v_order.origin_channel, ''unknown''),
         ''gross'',
         COALESCE(po.order_gross, 0),
         COALESCE(v_order.currency, ''GBP''),
         p.external_payout_id,
         ''actual:payout_order:'' || po.id::text,
         jsonb_build_object(''order_gross'', po.order_gross, ''order_fees'', po.order_fees),
         p.payout_date::timestamptz
  FROM public.payout_orders po
  JOIN public.payouts p ON p.id = po.payout_id
  WHERE po.sales_order_id = p_sales_order_id
  ON CONFLICT (idempotency_key) DO UPDATE
  SET category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source_system = EXCLUDED.source_system,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.actual_settlement_line (
    payout_id,
    sales_order_id,
    payout_fee_id,
    source_system,
    category,
    amount,
    currency,
    external_reference,
    idempotency_key,
    metadata,
    occurred_at
  )
  SELECT pf.payout_id,
         pf.sales_order_id,
         pf.id,
         pf.channel,
         ''fee'',
         -ABS(pf.amount),
         COALESCE(v_order.currency, ''GBP''),
         pf.external_order_id,
         ''actual:payout_fee:'' || pf.id::text,
         jsonb_build_object(''fee_category'', pf.fee_category),
         pf.created_at
  FROM public.payout_fee pf
  WHERE pf.sales_order_id = p_sales_order_id
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source_system = EXCLUDED.source_system,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  IF p_rebuild_cases THEN
    PERFORM public.rebuild_reconciliation_cases(p_sales_order_id);
  END IF;

  RETURN v_count;
END;';

GRANT EXECUTE ON FUNCTION public.refresh_order_settlement_lines(UUID, BOOLEAN)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_qbo_posting_intents_for_order(p_sales_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS 'DECLARE
  v_order public.sales_order%ROWTYPE;
  v_count INTEGER := 0;
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

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;';

GRANT EXECUTE ON FUNCTION public.queue_qbo_posting_intents_for_order(UUID)
  TO authenticated, service_role;
