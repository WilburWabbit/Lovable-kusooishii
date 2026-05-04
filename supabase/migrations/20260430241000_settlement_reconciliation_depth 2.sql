-- Deepen settlement reconciliation: richer actual settlement imports,
-- operational case actions, and period close/reporting views.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies only.

CREATE INDEX IF NOT EXISTS idx_actual_settlement_payout_category
  ON public.actual_settlement_line(payout_id, category, occurred_at)
  WHERE payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expected_settlement_order_category
  ON public.expected_settlement_line(sales_order_id, category)
  WHERE sales_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_case_period
  ON public.reconciliation_case(created_at, status, case_type);

CREATE OR REPLACE FUNCTION public.refresh_actual_settlement_lines(
  p_sales_order_id UUID DEFAULT NULL,
  p_payout_id UUID DEFAULT NULL,
  p_rebuild_cases BOOLEAN DEFAULT true
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  DELETE FROM public.actual_settlement_line asl
  WHERE asl.idempotency_key LIKE ''actual:payout_order:%''
    AND asl.idempotency_key NOT LIKE ''actual:payout_order:gross:%''
    AND asl.idempotency_key NOT LIKE ''actual:payout_order:net:%''
    AND (p_sales_order_id IS NULL OR asl.sales_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR asl.payout_id = p_payout_id);

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
  SELECT
    po.payout_id,
    po.sales_order_id,
    COALESCE(p.channel::text, so.origin_channel, ''unknown''),
    ''gross'',
    ROUND(COALESCE(po.order_gross, so.gross_total, 0)::numeric, 2),
    COALESCE(so.currency, ''GBP''),
    COALESCE(p.external_payout_id, po.id::text),
    ''actual:payout_order:gross:'' || po.id::text,
    jsonb_build_object(
      ''source'', ''payout_orders'',
      ''order_gross'', po.order_gross,
      ''order_fees'', po.order_fees,
      ''order_net'', po.order_net,
      ''external_payout_id'', p.external_payout_id
    ),
    p.payout_date::timestamptz
  FROM public.payout_orders po
  JOIN public.payouts p ON p.id = po.payout_id
  JOIN public.sales_order so ON so.id = po.sales_order_id
  WHERE (p_sales_order_id IS NULL OR po.sales_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR po.payout_id = p_payout_id)
    AND COALESCE(po.order_gross, so.gross_total, 0) <> 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.ebay_payout_transactions ept
      WHERE p.channel = ''ebay''
        AND ept.payout_id = p.external_payout_id
        AND ept.matched_order_id = po.sales_order_id
        AND ept.transaction_type IN (''SALE'', ''REFUND'')
    )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      sales_order_id = EXCLUDED.sales_order_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;

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
  SELECT
    po.payout_id,
    po.sales_order_id,
    COALESCE(p.channel::text, so.origin_channel, ''unknown''),
    ''net'',
    ROUND(COALESCE(po.order_net, COALESCE(po.order_gross, so.gross_total, 0) - COALESCE(po.order_fees, 0))::numeric, 2),
    COALESCE(so.currency, ''GBP''),
    COALESCE(p.external_payout_id, po.id::text),
    ''actual:payout_order:net:'' || po.id::text,
    jsonb_build_object(
      ''source'', ''payout_orders'',
      ''order_gross'', po.order_gross,
      ''order_fees'', po.order_fees,
      ''order_net'', po.order_net,
      ''external_payout_id'', p.external_payout_id
    ),
    p.payout_date::timestamptz
  FROM public.payout_orders po
  JOIN public.payouts p ON p.id = po.payout_id
  JOIN public.sales_order so ON so.id = po.sales_order_id
  WHERE (p_sales_order_id IS NULL OR po.sales_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR po.payout_id = p_payout_id)
    AND COALESCE(po.order_net, COALESCE(po.order_gross, so.gross_total, 0) - COALESCE(po.order_fees, 0)) <> 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.ebay_payout_transactions ept
      WHERE p.channel = ''ebay''
        AND ept.payout_id = p.external_payout_id
        AND ept.matched_order_id = po.sales_order_id
        AND ept.transaction_type IN (''SALE'', ''REFUND'')
    )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      sales_order_id = EXCLUDED.sales_order_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
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
  SELECT
    pf.payout_id,
    pf.sales_order_id,
    pf.id,
    pf.channel,
    CASE
      WHEN pf.fee_category = ''shipping_label'' THEN ''shipping''
      ELSE ''fee''
    END,
    -ABS(ROUND(pf.amount::numeric, 2)),
    ''GBP'',
    COALESCE(pf.external_order_id, pf.id::text),
    ''actual:payout_fee:'' || pf.id::text,
    jsonb_build_object(
      ''source'', ''payout_fee'',
      ''fee_category'', pf.fee_category,
      ''description'', pf.description,
      ''external_order_id'', pf.external_order_id
    ),
    pf.created_at
  FROM public.payout_fee pf
  WHERE (p_sales_order_id IS NULL OR pf.sales_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR pf.payout_id = p_payout_id)
    AND (
      pf.channel <> ''ebay''
      OR NOT EXISTS (
        SELECT 1
        FROM public.payouts p
        JOIN public.ebay_payout_transactions ept ON ept.payout_id = p.external_payout_id
        WHERE p.id = pf.payout_id
          AND ept.order_id = pf.external_order_id
          AND ept.total_fees <> 0
      )
    )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      sales_order_id = EXCLUDED.sales_order_id,
      payout_fee_id = EXCLUDED.payout_fee_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;

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
  SELECT
    p.id,
    ept.matched_order_id,
    ''ebay'',
    CASE
      WHEN ept.transaction_type = ''REFUND'' THEN ''refund''
      WHEN ept.transaction_type IN (''SHIPPING_LABEL'', ''NON_SALE_CHARGE'', ''DISPUTE'') THEN ''fee''
      ELSE ''gross''
    END,
    ROUND(
      CASE
        WHEN ept.transaction_type = ''REFUND'' THEN -ABS(COALESCE(NULLIF(ept.gross_amount, 0), ept.net_amount, 0))
        WHEN ept.transaction_type IN (''SHIPPING_LABEL'', ''NON_SALE_CHARGE'', ''DISPUTE'') THEN -ABS(COALESCE(NULLIF(ept.gross_amount, 0), ept.net_amount, 0))
        ELSE ABS(COALESCE(NULLIF(ept.gross_amount, 0), ept.net_amount, 0))
      END::numeric,
      2
    ),
    COALESCE(ept.currency, ''GBP''),
    ept.transaction_id,
    ''actual:ebay_transaction:amount:'' || ept.transaction_id || '':'' || ept.transaction_type,
    jsonb_build_object(
      ''source'', ''ebay_payout_transactions'',
      ''external_payout_id'', ept.payout_id,
      ''order_id'', ept.order_id,
      ''transaction_type'', ept.transaction_type,
      ''transaction_status'', ept.transaction_status,
      ''memo'', ept.memo
    ),
    ept.transaction_date::timestamptz
  FROM public.ebay_payout_transactions ept
  JOIN public.payouts p ON p.external_payout_id = ept.payout_id AND p.channel = ''ebay''
  WHERE (p_sales_order_id IS NULL OR ept.matched_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR p.id = p_payout_id)
    AND COALESCE(NULLIF(ept.gross_amount, 0), ept.net_amount, 0) <> 0
    AND ept.transaction_type IN (''SALE'', ''REFUND'', ''SHIPPING_LABEL'', ''NON_SALE_CHARGE'', ''DISPUTE'')
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      sales_order_id = EXCLUDED.sales_order_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;

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
  SELECT
    p.id,
    ept.matched_order_id,
    ''ebay'',
    ''fee'',
    -ABS(ROUND(ept.total_fees::numeric, 2)),
    COALESCE(ept.currency, ''GBP''),
    ept.transaction_id,
    ''actual:ebay_transaction:fees:'' || ept.transaction_id || '':'' || ept.transaction_type,
    jsonb_build_object(
      ''source'', ''ebay_payout_transactions'',
      ''external_payout_id'', ept.payout_id,
      ''order_id'', ept.order_id,
      ''transaction_type'', ept.transaction_type,
      ''fee_details'', ept.fee_details
    ),
    ept.transaction_date::timestamptz
  FROM public.ebay_payout_transactions ept
  JOIN public.payouts p ON p.external_payout_id = ept.payout_id AND p.channel = ''ebay''
  WHERE (p_sales_order_id IS NULL OR ept.matched_order_id = p_sales_order_id)
    AND (p_payout_id IS NULL OR p.id = p_payout_id)
    AND COALESCE(ept.total_fees, 0) <> 0
    AND ept.transaction_type IN (''SALE'', ''REFUND'')
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      sales_order_id = EXCLUDED.sales_order_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO public.actual_settlement_line (
    payout_id,
    source_system,
    category,
    amount,
    currency,
    external_reference,
    idempotency_key,
    metadata,
    occurred_at
  )
  SELECT
    p.id,
    p.channel::text,
    ''deposit'',
    ROUND(p.net_amount::numeric, 2),
    ''GBP'',
    COALESCE(p.external_payout_id, p.id::text),
    ''actual:payout_deposit:'' || p.id::text,
    jsonb_build_object(
      ''source'', ''payouts'',
      ''gross_amount'', p.gross_amount,
      ''total_fees'', p.total_fees,
      ''net_amount'', p.net_amount,
      ''bank_reference'', p.bank_reference,
      ''qbo_deposit_id'', p.qbo_deposit_id,
      ''qbo_sync_status'', p.qbo_sync_status
    ),
    p.payout_date::timestamptz
  FROM public.payouts p
  WHERE (p_payout_id IS NULL OR p.id = p_payout_id)
    AND (p_sales_order_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.payout_orders po
      WHERE po.payout_id = p.id
        AND po.sales_order_id = p_sales_order_id
    ))
  ON CONFLICT (idempotency_key) DO UPDATE
  SET payout_id = EXCLUDED.payout_id,
      source_system = EXCLUDED.source_system,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      external_reference = EXCLUDED.external_reference,
      metadata = EXCLUDED.metadata,
      occurred_at = EXCLUDED.occurred_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  IF p_rebuild_cases THEN
    PERFORM public.rebuild_reconciliation_cases(p_sales_order_id);
  END IF;

  RETURN v_count;
END;
';

GRANT EXECUTE ON FUNCTION public.refresh_actual_settlement_lines(UUID, UUID, BOOLEAN)
TO authenticated, service_role;

COMMENT ON FUNCTION public.refresh_actual_settlement_lines(UUID, UUID, BOOLEAN) IS
  'Rebuilds actual settlement evidence from payout_orders, payout_fee, eBay payout transactions, and payout deposits.';

CREATE OR REPLACE FUNCTION public.resolve_reconciliation_case(
  p_case_id UUID,
  p_resolution TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_case public.reconciliation_case%ROWTYPE;
  v_linked_order_id UUID;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to resolve reconciliation cases'';
  END IF;

  SELECT * INTO v_case
  FROM public.reconciliation_case
  WHERE id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Reconciliation case % not found'', p_case_id;
  END IF;

  IF p_resolution = ''mark_in_progress'' THEN
    UPDATE public.reconciliation_case
    SET status = ''in_progress'',
        evidence = evidence || jsonb_build_object(''last_operator_note'', p_note, ''last_action'', p_resolution),
        updated_at = now()
    WHERE id = p_case_id;
    RETURN jsonb_build_object(''success'', true, ''action'', p_resolution);
  END IF;

  IF p_resolution = ''refresh_settlement'' THEN
    IF v_case.sales_order_id IS NOT NULL THEN
      PERFORM public.refresh_order_settlement_lines(v_case.sales_order_id, false);
      PERFORM public.refresh_actual_settlement_lines(v_case.sales_order_id, v_case.payout_id, true);
    ELSIF v_case.payout_id IS NOT NULL THEN
      PERFORM public.refresh_actual_settlement_lines(NULL, v_case.payout_id, true);
    ELSE
      PERFORM public.refresh_actual_settlement_lines(NULL, NULL, true);
    END IF;

    UPDATE public.reconciliation_case
    SET status = ''in_progress'',
        evidence = evidence || jsonb_build_object(''last_operator_note'', p_note, ''last_action'', p_resolution, ''refreshed_at'', now()),
        updated_at = now()
    WHERE id = p_case_id
      AND status = ''open'';

    RETURN jsonb_build_object(''success'', true, ''action'', p_resolution);
  END IF;

  IF p_resolution = ''link_payout_fee_by_external_order'' THEN
    IF v_case.related_entity_type <> ''payout_fee'' OR v_case.related_entity_id IS NULL THEN
      RAISE EXCEPTION ''Case % is not linked to a payout_fee'', p_case_id;
    END IF;

    UPDATE public.payout_fee pf
    SET sales_order_id = so.id,
        updated_at = now()
    FROM public.sales_order so
    WHERE pf.id = v_case.related_entity_id
      AND pf.sales_order_id IS NULL
      AND pf.external_order_id IS NOT NULL
      AND so.origin_reference = pf.external_order_id
    RETURNING so.id INTO v_linked_order_id;

    IF v_linked_order_id IS NULL THEN
      RAISE EXCEPTION ''No sales_order.origin_reference matched payout_fee external order id'';
    END IF;

    PERFORM public.refresh_order_settlement_lines(v_linked_order_id, false);
    PERFORM public.refresh_actual_settlement_lines(v_linked_order_id, NULL, true);

    UPDATE public.reconciliation_case
    SET status = ''resolved'',
        sales_order_id = COALESCE(sales_order_id, v_linked_order_id),
        close_code = ''linked_payout_fee_by_external_order'',
        closed_at = now(),
        evidence = evidence || jsonb_build_object(''last_operator_note'', p_note, ''linked_sales_order_id'', v_linked_order_id),
        updated_at = now()
    WHERE id = p_case_id;

    RETURN jsonb_build_object(''success'', true, ''action'', p_resolution, ''sales_order_id'', v_linked_order_id);
  END IF;

  IF p_resolution = ''queue_qbo_order_posting'' THEN
    IF v_case.sales_order_id IS NULL THEN
      RAISE EXCEPTION ''Case % is not linked to a sales order'', p_case_id;
    END IF;

    SELECT public.queue_qbo_posting_intents_for_order(v_case.sales_order_id)
    INTO v_count;

    UPDATE public.reconciliation_case
    SET status = ''in_progress'',
        evidence = evidence || jsonb_build_object(''last_operator_note'', p_note, ''last_action'', p_resolution, ''queued_count'', v_count),
        updated_at = now()
    WHERE id = p_case_id;

    RETURN jsonb_build_object(''success'', true, ''action'', p_resolution, ''queued_count'', v_count);
  END IF;

  IF p_resolution = ''queue_qbo_payout_posting'' THEN
    IF v_case.payout_id IS NULL THEN
      RAISE EXCEPTION ''Case % is not linked to a payout'', p_case_id;
    END IF;

    RETURN jsonb_build_object(
      ''success'', true,
      ''action'', p_resolution,
      ''posting_intent_id'', public.queue_qbo_payout_posting_intent(v_case.payout_id)
    );
  END IF;

  IF p_resolution IN (''mark_resolved'', ''ignore'') THEN
    UPDATE public.reconciliation_case
    SET status = CASE WHEN p_resolution = ''ignore'' THEN ''ignored'' ELSE ''resolved'' END,
        close_code = CASE WHEN p_resolution = ''ignore'' THEN ''operator_ignored'' ELSE ''operator_resolved'' END,
        closed_at = now(),
        evidence = evidence || jsonb_build_object(''last_operator_note'', p_note, ''last_action'', p_resolution),
        updated_at = now()
    WHERE id = p_case_id;

    RETURN jsonb_build_object(''success'', true, ''action'', p_resolution);
  END IF;

  RAISE EXCEPTION ''Unsupported reconciliation resolution action: %'', p_resolution;
END;
';

GRANT EXECUTE ON FUNCTION public.resolve_reconciliation_case(UUID, TEXT, TEXT)
TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_settlement_order_rollup AS
WITH expected AS (
  SELECT
    sales_order_id,
    COALESCE(SUM(amount) FILTER (WHERE category = 'gross'), 0) AS expected_gross,
    COALESCE(SUM(amount) FILTER (WHERE category = 'shipping'), 0) AS expected_shipping,
    COALESCE(SUM(amount) FILTER (WHERE category = 'tax'), 0) AS expected_tax,
    COALESCE(SUM(amount) FILTER (WHERE category = 'discount'), 0) AS expected_discount,
    COALESCE(SUM(amount) FILTER (WHERE category = 'fee'), 0) AS expected_fees,
    COALESCE(SUM(amount) FILTER (WHERE category = 'commission'), 0) AS expected_commission,
    COALESCE(SUM(amount), 0) AS expected_total
  FROM public.expected_settlement_line
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
),
actual AS (
  SELECT
    sales_order_id,
    COALESCE(SUM(amount) FILTER (WHERE category = 'gross'), 0) AS actual_gross,
    COALESCE(SUM(amount) FILTER (WHERE category = 'shipping'), 0) AS actual_shipping,
    COALESCE(SUM(amount) FILTER (WHERE category = 'fee'), 0) AS actual_fees,
    COALESCE(SUM(amount) FILTER (WHERE category = 'refund'), 0) AS actual_refunds,
    COALESCE(SUM(amount) FILTER (WHERE category = 'net'), 0) AS actual_net_lines,
    COALESCE(SUM(amount) FILTER (WHERE category NOT IN ('deposit', 'net')), 0) AS actual_total
  FROM public.actual_settlement_line
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
),
cases AS (
  SELECT
    sales_order_id,
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_case_count,
    COUNT(*) FILTER (WHERE case_type = 'missing_payout' AND status IN ('open', 'in_progress')) AS missing_payout_case_count,
    COUNT(*) FILTER (WHERE case_type = 'amount_mismatch' AND status IN ('open', 'in_progress')) AS amount_mismatch_case_count
  FROM public.reconciliation_case
  WHERE sales_order_id IS NOT NULL
  GROUP BY sales_order_id
)
SELECT
  so.id AS sales_order_id,
  so.order_number,
  so.origin_channel,
  so.created_at::date AS order_date,
  date_trunc('month', COALESCE(so.created_at, now()))::date AS period_start,
  (date_trunc('month', COALESCE(so.created_at, now())) + interval '1 month - 1 day')::date AS period_end,
  COALESCE(e.expected_gross, 0) AS expected_gross,
  COALESCE(e.expected_shipping, 0) AS expected_shipping,
  COALESCE(e.expected_tax, 0) AS expected_tax,
  COALESCE(e.expected_discount, 0) AS expected_discount,
  COALESCE(e.expected_fees, 0) AS expected_fees,
  COALESCE(e.expected_commission, 0) AS expected_commission,
  COALESCE(e.expected_total, 0) AS expected_total,
  COALESCE(a.actual_gross, 0) AS actual_gross,
  COALESCE(a.actual_shipping, 0) AS actual_shipping,
  COALESCE(a.actual_fees, 0) AS actual_fees,
  COALESCE(a.actual_refunds, 0) AS actual_refunds,
  COALESCE(a.actual_net_lines, 0) AS actual_net_lines,
  COALESCE(a.actual_total, 0) AS actual_total,
  ROUND(COALESCE(e.expected_total, 0) - COALESCE(a.actual_total, 0), 2) AS variance_amount,
  COALESCE(c.open_case_count, 0) AS open_case_count,
  COALESCE(c.missing_payout_case_count, 0) AS missing_payout_case_count,
  COALESCE(c.amount_mismatch_case_count, 0) AS amount_mismatch_case_count
FROM public.sales_order so
LEFT JOIN expected e ON e.sales_order_id = so.id
LEFT JOIN actual a ON a.sales_order_id = so.id
LEFT JOIN cases c ON c.sales_order_id = so.id;

CREATE OR REPLACE VIEW public.v_settlement_period_summary AS
WITH order_rollup AS (
  SELECT *
  FROM public.v_settlement_order_rollup
),
payout_rollup AS (
  SELECT
    date_trunc('month', p.payout_date::timestamptz)::date AS period_start,
    p.channel::text AS channel,
    COUNT(*) AS payout_count,
    COALESCE(SUM(p.gross_amount), 0) AS payout_gross,
    COALESCE(SUM(p.total_fees), 0) AS payout_fees,
    COALESCE(SUM(p.net_amount), 0) AS payout_net,
    COUNT(*) FILTER (WHERE COALESCE(p.reconciliation_status, 'pending') <> 'reconciled') AS unreconciled_payout_count
  FROM public.payouts p
  GROUP BY date_trunc('month', p.payout_date::timestamptz)::date, p.channel::text
)
SELECT
  o.period_start,
  o.period_end,
  COALESCE(o.origin_channel, 'unknown') AS channel,
  COUNT(*) AS order_count,
  COALESCE(SUM(o.expected_gross), 0) AS expected_gross,
  COALESCE(SUM(o.expected_shipping), 0) AS expected_shipping,
  COALESCE(SUM(o.expected_tax), 0) AS expected_tax,
  COALESCE(SUM(o.expected_discount), 0) AS expected_discount,
  COALESCE(SUM(o.expected_fees), 0) AS expected_fees,
  COALESCE(SUM(o.expected_commission), 0) AS expected_commission,
  COALESCE(SUM(o.expected_total), 0) AS expected_total,
  COALESCE(SUM(o.actual_gross), 0) AS actual_gross,
  COALESCE(SUM(o.actual_shipping), 0) AS actual_shipping,
  COALESCE(SUM(o.actual_fees), 0) AS actual_fees,
  COALESCE(SUM(o.actual_refunds), 0) AS actual_refunds,
  COALESCE(SUM(o.actual_total), 0) AS actual_total,
  ROUND(COALESCE(SUM(o.expected_total), 0) - COALESCE(SUM(o.actual_total), 0), 2) AS variance_amount,
  COALESCE(MAX(pr.payout_count), 0) AS payout_count,
  COALESCE(MAX(pr.payout_gross), 0) AS payout_gross,
  COALESCE(MAX(pr.payout_fees), 0) AS payout_fees,
  COALESCE(MAX(pr.payout_net), 0) AS payout_net,
  COALESCE(MAX(pr.unreconciled_payout_count), 0) AS unreconciled_payout_count,
  COALESCE(SUM(o.open_case_count), 0) AS open_case_count,
  COALESCE(SUM(o.missing_payout_case_count), 0) AS missing_payout_case_count,
  COALESCE(SUM(o.amount_mismatch_case_count), 0) AS amount_mismatch_case_count
FROM order_rollup o
LEFT JOIN payout_rollup pr
  ON pr.period_start = o.period_start
 AND pr.channel = CASE WHEN o.origin_channel = 'web' THEN 'stripe' ELSE o.origin_channel END
GROUP BY o.period_start, o.period_end, COALESCE(o.origin_channel, 'unknown')
ORDER BY o.period_start DESC, channel;

CREATE OR REPLACE VIEW public.v_settlement_period_close AS
SELECT
  period_start,
  period_end,
  COUNT(*) AS channel_count,
  SUM(order_count) AS order_count,
  SUM(expected_total) AS expected_total,
  SUM(actual_total) AS actual_total,
  ROUND(SUM(variance_amount), 2) AS variance_amount,
  SUM(payout_count) AS payout_count,
  SUM(unreconciled_payout_count) AS unreconciled_payout_count,
  SUM(open_case_count) AS open_case_count,
  SUM(missing_payout_case_count) AS missing_payout_case_count,
  SUM(amount_mismatch_case_count) AS amount_mismatch_case_count,
  CASE
    WHEN SUM(open_case_count) > 0 THEN 'blocked'
    WHEN ABS(SUM(variance_amount)) > 0.05 THEN 'review'
    WHEN SUM(unreconciled_payout_count) > 0 THEN 'review'
    ELSE 'ready'
  END AS close_status
FROM public.v_settlement_period_summary
GROUP BY period_start, period_end
ORDER BY period_start DESC;

GRANT SELECT ON public.v_settlement_order_rollup TO authenticated;
GRANT SELECT ON public.v_settlement_period_summary TO authenticated;
GRANT SELECT ON public.v_settlement_period_close TO authenticated;
