CREATE OR REPLACE FUNCTION public.record_order_accounting_events(
  p_sales_order_id UUID,
  p_source TEXT DEFAULT 'order_processor'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.sales_order%ROWTYPE;
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order % not found', p_sales_order_id;
  END IF;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    credit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'revenue', 'sales_order', v_order.id, v_order.id,
         COALESCE(v_order.net_amount, v_order.gross_total - v_order.tax_total, v_order.gross_total, 0),
         COALESCE(v_order.currency, 'GBP'),
         'sales_revenue',
         p_source,
         'order_revenue:' || v_order.id::text,
         COALESCE(v_order.created_at, now())
  WHERE COALESCE(v_order.gross_total, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    credit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'vat', 'sales_order', v_order.id, v_order.id,
         COALESCE(NULLIF(v_order.tax_total, 0), v_order.vat_amount, 0),
         COALESCE(v_order.currency, 'GBP'),
         'vat_payable',
         p_source,
         'order_vat:' || v_order.id::text,
         COALESCE(v_order.created_at, now())
  WHERE COALESCE(NULLIF(v_order.tax_total, 0), v_order.vat_amount, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    debit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'discount', 'sales_order', v_order.id, v_order.id,
         COALESCE(v_order.discount_total, v_order.club_discount_amount, 0),
         COALESCE(v_order.currency, 'GBP'),
         'sales_discounts',
         p_source,
         'order_discount:' || v_order.id::text,
         COALESCE(v_order.created_at, now())
  WHERE COALESCE(v_order.discount_total, v_order.club_discount_amount, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    credit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'shipping_income', 'sales_order', v_order.id, v_order.id,
         COALESCE(v_order.shipping_total, 0),
         COALESCE(v_order.currency, 'GBP'),
         'shipping_income',
         p_source,
         'order_shipping:' || v_order.id::text,
         COALESCE(v_order.created_at, now())
  WHERE COALESCE(v_order.shipping_total, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    sales_order_line_id,
    stock_unit_id,
    amount,
    currency,
    debit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'cogs', 'sales_order_line', sol.id, sol.sales_order_id, sol.id, sol.stock_unit_id,
         COALESCE(sol.cogs_amount, sol.cogs, 0),
         COALESCE(v_order.currency, 'GBP'),
         'cost_of_goods_sold',
         p_source,
         'line_cogs:' || sol.id::text,
         COALESCE(v_order.created_at, sol.created_at, now())
  FROM public.sales_order_line sol
  WHERE sol.sales_order_id = p_sales_order_id
    AND COALESCE(sol.cogs_amount, sol.cogs, 0) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET stock_unit_id = EXCLUDED.stock_unit_id,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    debit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'fee_expense', 'sales_order', pf.sales_order_id, pf.sales_order_id,
         SUM(pf.amount),
         COALESCE(v_order.currency, 'GBP'),
         'channel_fee_expense',
         p_source,
         'order_fees:' || pf.sales_order_id::text,
         MIN(pf.created_at)
  FROM public.payout_fee pf
  WHERE pf.sales_order_id = p_sales_order_id
  GROUP BY pf.sales_order_id
  HAVING SUM(pf.amount) <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.accounting_event (
    event_type,
    entity_type,
    entity_id,
    sales_order_id,
    amount,
    currency,
    debit_account_purpose,
    credit_account_purpose,
    source,
    idempotency_key,
    occurred_at
  )
  SELECT 'commission_expense', 'sales_program_accrual', spa.id, spa.sales_order_id,
         spa.commission_amount - spa.reversed_amount,
         spa.currency,
         'club_commission_expense',
         'club_commission_payable',
         p_source,
         'program_commission:' || spa.id::text,
         spa.created_at
  FROM public.sales_program_accrual spa
  WHERE spa.sales_order_id = p_sales_order_id
    AND spa.accrual_type = 'commission'
    AND spa.commission_amount - spa.reversed_amount <> 0
  ON CONFLICT (idempotency_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      source = EXCLUDED.source,
      metadata = accounting_event.metadata || jsonb_build_object('refreshed_at', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_order_accounting_events(UUID, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_qbo_posting_intents_for_order(p_sales_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.sales_order%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order % not found', p_sales_order_id;
  END IF;

  IF v_order.qbo_sales_receipt_id IS NOT NULL THEN
    PERFORM public.record_order_accounting_events(p_sales_order_id, 'posting_intent_existing_qbo_reference');
    RETURN 0;
  END IF;

  PERFORM public.record_order_accounting_events(p_sales_order_id, 'posting_intent_queue');

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
    'qbo',
    'create_sales_receipt',
    'sales_order',
    p_sales_order_id,
    'qbo:create_sales_receipt:' || p_sales_order_id::text,
    'pending',
    jsonb_build_object(
      'sales_order_id', p_sales_order_id,
      'order_number', v_order.order_number,
      'gross_total', v_order.gross_total,
      'currency', v_order.currency,
      'queued_at', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE
        WHEN posting_intent.status IN ('failed', 'cancelled') THEN 'pending'
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN ('failed', 'cancelled') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_qbo_posting_intents_for_order(UUID)
  TO authenticated, service_role;
