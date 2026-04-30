-- Queue QBO RefundReceipt posting intents for returned/refunded order lines.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar-quoted delimiters.

CREATE OR REPLACE FUNCTION public.queue_qbo_refund_posting_intent_for_order(
  p_sales_order_id UUID,
  p_refunded_line_ids UUID[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_order public.sales_order%ROWTYPE;
  v_line_ids UUID[];
  v_intent_id UUID;
  v_idempotency_key TEXT;
BEGIN
  SELECT * INTO v_order
  FROM public.sales_order
  WHERE id = p_sales_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''sales_order % not found'', p_sales_order_id;
  END IF;

  SELECT COALESCE(array_agg(line_id ORDER BY line_id), ARRAY[]::uuid[])
  INTO v_line_ids
  FROM (
    SELECT DISTINCT unnest(COALESCE(p_refunded_line_ids, ARRAY[]::uuid[])) AS line_id
  ) lines
  WHERE line_id IS NOT NULL;

  IF array_length(v_line_ids, 1) IS NULL THEN
    SELECT COALESCE(array_agg(sol.id ORDER BY sol.id), ARRAY[]::uuid[])
    INTO v_line_ids
    FROM public.sales_order_line sol
    JOIN public.stock_unit su ON su.id = sol.stock_unit_id
    WHERE sol.sales_order_id = p_sales_order_id
      AND su.v2_status = ''refunded'';
  END IF;

  IF array_length(v_line_ids, 1) IS NULL THEN
    RAISE EXCEPTION ''No refunded sales_order_line rows found for order %'', p_sales_order_id;
  END IF;

  v_idempotency_key :=
    ''qbo_refund_receipt:'' || p_sales_order_id::text || '':'' || array_to_string(v_line_ids, '','');

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
    ''create_refund_receipt'',
    ''sales_order'',
    p_sales_order_id,
    v_idempotency_key,
    ''pending'',
    jsonb_build_object(
      ''sales_order_id'', p_sales_order_id,
      ''refunded_line_ids'', to_jsonb(v_line_ids),
      ''source'', ''return_processor''
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET status = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'') THEN ''pending''
        ELSE posting_intent.status
      END,
      next_attempt_at = CASE
        WHEN posting_intent.status IN (''failed'', ''cancelled'') THEN now()
        ELSE posting_intent.next_attempt_at
      END,
      payload = EXCLUDED.payload,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_refund_posting_intent_for_order(UUID, UUID[])
TO authenticated, service_role;
