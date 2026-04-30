-- Process returned order lines through the commerce subledger.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar-quoted delimiters.

CREATE OR REPLACE FUNCTION public.process_order_return(
  p_sales_order_id UUID,
  p_line_actions JSONB,
  p_reason TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_order public.sales_order%ROWTYPE;
  v_action JSONB;
  v_line public.sales_order_line%ROWTYPE;
  v_action_text TEXT;
  v_refunded_count INTEGER := 0;
  v_restocked_count INTEGER := 0;
  v_refund_total NUMERIC(12,2) := 0;
  v_refund_ratio NUMERIC := 0;
BEGIN
  IF p_line_actions IS NULL OR jsonb_typeof(p_line_actions) <> ''array'' OR jsonb_array_length(p_line_actions) = 0 THEN
    RAISE EXCEPTION ''p_line_actions must be a non-empty JSON array'';
  END IF;

  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order % not found'', p_sales_order_id;
  END IF;

  FOR v_action IN SELECT value FROM jsonb_array_elements(p_line_actions)
  LOOP
    v_action_text := v_action->>''action'';

    IF v_action_text NOT IN (''refund'', ''restock'') THEN
      RAISE EXCEPTION ''Unsupported return action %'', v_action_text;
    END IF;

    SELECT * INTO v_line
    FROM public.sales_order_line
    WHERE id = (v_action->>''line_item_id'')::uuid
      AND sales_order_id = p_sales_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION ''sales_order_line % not found for order %'', v_action->>''line_item_id'', p_sales_order_id;
    END IF;

    IF v_line.stock_unit_id IS NULL THEN
      RAISE EXCEPTION ''sales_order_line % has no stock unit to return'', v_line.id;
    END IF;

    IF v_action_text = ''refund'' THEN
      UPDATE public.stock_unit
      SET v2_status = ''refunded'',
          updated_at = now()
      WHERE id = v_line.stock_unit_id;

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
        metadata,
        occurred_at
      )
      VALUES (
        ''refund'',
        ''sales_order_line'',
        v_line.id,
        p_sales_order_id,
        v_line.id,
        v_line.stock_unit_id,
        -ABS(COALESCE(v_line.line_total, v_line.unit_price * v_line.quantity, 0)),
        COALESCE(v_order.currency, ''GBP''),
        ''sales_refunds'',
        ''return_processor'',
        ''return_refund:'' || v_line.id::text,
        jsonb_build_object(''reason'', p_reason, ''actor_id'', p_actor_id),
        now()
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          metadata = EXCLUDED.metadata || jsonb_build_object(''refreshed_at'', now()),
          occurred_at = EXCLUDED.occurred_at;

      INSERT INTO public.accounting_event (
        event_type,
        entity_type,
        entity_id,
        sales_order_id,
        sales_order_line_id,
        amount,
        currency,
        credit_account_purpose,
        source,
        idempotency_key,
        metadata,
        occurred_at
      )
      SELECT
        ''vat'',
        ''sales_order_line'',
        v_line.id,
        p_sales_order_id,
        v_line.id,
        -ABS(ROUND(COALESCE(v_order.tax_total, 0) * (
          ABS(COALESCE(v_line.line_total, v_line.unit_price * v_line.quantity, 0))
          / NULLIF(ABS(COALESCE(v_order.gross_total, 0)), 0)
        ), 2)),
        COALESCE(v_order.currency, ''GBP''),
        ''vat_payable'',
        ''return_processor'',
        ''return_vat_reversal:'' || v_line.id::text,
        jsonb_build_object(''reason'', p_reason, ''actor_id'', p_actor_id),
        now()
      WHERE COALESCE(v_order.tax_total, 0) <> 0
        AND COALESCE(v_order.gross_total, 0) <> 0
      ON CONFLICT (idempotency_key) DO UPDATE
      SET amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          metadata = EXCLUDED.metadata || jsonb_build_object(''refreshed_at'', now()),
          occurred_at = EXCLUDED.occurred_at;

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
        metadata,
        occurred_at
      )
      SELECT
        ''cogs'',
        ''sales_order_line'',
        v_line.id,
        p_sales_order_id,
        v_line.id,
        v_line.stock_unit_id,
        -ABS(COALESCE(v_line.cogs_amount, v_line.cogs, 0)),
        COALESCE(v_order.currency, ''GBP''),
        ''cost_of_goods_sold'',
        ''return_processor'',
        ''return_cogs_reversal:'' || v_line.id::text,
        jsonb_build_object(''reason'', p_reason, ''actor_id'', p_actor_id),
        now()
      WHERE COALESCE(v_line.cogs_amount, v_line.cogs, 0) <> 0
      ON CONFLICT (idempotency_key) DO UPDATE
      SET amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          metadata = EXCLUDED.metadata || jsonb_build_object(''refreshed_at'', now()),
          occurred_at = EXCLUDED.occurred_at;

      INSERT INTO public.stock_cost_event (
        stock_unit_id,
        sales_order_id,
        sales_order_line_id,
        event_type,
        amount,
        currency,
        costing_method,
        carrying_value_before,
        carrying_value_after,
        source,
        idempotency_key,
        metadata,
        event_at
      )
      SELECT
        su.id,
        p_sales_order_id,
        v_line.id,
        ''return_reversal'',
        -ABS(COALESCE(v_line.cogs_amount, v_line.cogs, su.carrying_value, su.landed_cost, 0)),
        COALESCE(v_order.currency, ''GBP''),
        COALESCE(v_line.costing_method, ''specific_unit''),
        COALESCE(su.carrying_value, su.landed_cost, 0),
        COALESCE(su.carrying_value, su.landed_cost, 0),
        ''return_processor'',
        ''return_cost_reversal:'' || v_line.id::text,
        jsonb_build_object(''reason'', p_reason, ''actor_id'', p_actor_id),
        now()
      FROM public.stock_unit su
      WHERE su.id = v_line.stock_unit_id
      ON CONFLICT (idempotency_key) DO UPDATE
      SET amount = EXCLUDED.amount,
          metadata = EXCLUDED.metadata || jsonb_build_object(''refreshed_at'', now()),
          event_at = EXCLUDED.event_at;

      INSERT INTO public.expected_settlement_line (
        sales_order_id,
        sales_order_line_id,
        category,
        amount,
        currency,
        source,
        confidence,
        idempotency_key,
        metadata,
        created_at
      )
      VALUES (
        p_sales_order_id,
        v_line.id,
        ''refund'',
        -ABS(COALESCE(v_line.line_total, v_line.unit_price * v_line.quantity, 0)),
        COALESCE(v_order.currency, ''GBP''),
        ''return_processor'',
        ''actual'',
        ''expected:refund:'' || v_line.id::text,
        jsonb_build_object(''reason'', p_reason, ''actor_id'', p_actor_id),
        now()
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          metadata = EXCLUDED.metadata;

      v_refund_total := v_refund_total + ABS(COALESCE(v_line.line_total, v_line.unit_price * v_line.quantity, 0));
      v_refunded_count := v_refunded_count + 1;
    ELSE
      UPDATE public.stock_unit
      SET v2_status = ''listed'',
          order_id = NULL,
          listed_at = now(),
          updated_at = now()
      WHERE id = v_line.stock_unit_id;

      v_restocked_count := v_restocked_count + 1;
    END IF;
  END LOOP;

  IF v_refund_total > 0 THEN
    v_refund_ratio := CASE
      WHEN COALESCE(v_order.merchandise_subtotal, 0) > 0
        THEN LEAST(1, v_refund_total / v_order.merchandise_subtotal)
      ELSE 1
    END;

    UPDATE public.sales_program_accrual
    SET reversed_amount = LEAST(commission_amount, ROUND(commission_amount * v_refund_ratio, 2)),
        status = CASE
          WHEN LEAST(commission_amount, ROUND(commission_amount * v_refund_ratio, 2)) >= commission_amount THEN ''reversed''
          ELSE status
        END,
        metadata = metadata || jsonb_build_object(''return_processed_at'', now(), ''refund_ratio'', v_refund_ratio),
        updated_at = now()
    WHERE sales_order_id = p_sales_order_id
      AND accrual_type = ''commission''
      AND status IN (''open'', ''partially_settled'', ''settled'');
  END IF;

  UPDATE public.sales_order
  SET status = CASE WHEN v_refunded_count = jsonb_array_length(p_line_actions) AND v_restocked_count = 0 THEN ''refunded'' ELSE ''complete'' END,
      v2_status = CASE WHEN v_refunded_count = jsonb_array_length(p_line_actions) AND v_restocked_count = 0 THEN ''refunded'' ELSE ''complete'' END,
      updated_at = now()
  WHERE id = p_sales_order_id;

  PERFORM public.refresh_order_line_economics(p_sales_order_id);
  PERFORM public.refresh_order_settlement_lines(p_sales_order_id, true);
  PERFORM public.record_order_accounting_events(p_sales_order_id, ''return_processor'');

  INSERT INTO public.audit_event (
    entity_type,
    entity_id,
    trigger_type,
    actor_type,
    source_system,
    after_json
  )
  VALUES (
    ''sales_order'',
    p_sales_order_id,
    ''admin_action'',
    ''user'',
    ''admin_v2'',
    jsonb_build_object(
      ''action'', ''return_processed'',
      ''reason'', p_reason,
      ''actor_id'', p_actor_id,
      ''line_actions'', p_line_actions,
      ''refunded_count'', v_refunded_count,
      ''restocked_count'', v_restocked_count,
      ''refund_total'', v_refund_total
    )
  );

  RETURN jsonb_build_object(
    ''sales_order_id'', p_sales_order_id,
    ''refunded_count'', v_refunded_count,
    ''restocked_count'', v_restocked_count,
    ''refund_total'', v_refund_total
  );
END;
';

GRANT EXECUTE ON FUNCTION public.process_order_return(UUID, JSONB, TEXT, UUID)
TO authenticated, service_role;
