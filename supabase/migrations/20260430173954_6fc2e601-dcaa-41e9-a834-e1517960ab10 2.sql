CREATE OR REPLACE FUNCTION public.queue_qbo_item_posting_intent(
  p_sku_id UUID,
  p_old_sku_code TEXT DEFAULT NULL,
  p_purchase_cost NUMERIC DEFAULT NULL,
  p_supplier_vat_registered BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_sku public.sku%ROWTYPE;
  v_intent_id UUID;
BEGIN
  SELECT * INTO v_sku FROM public.sku WHERE id = p_sku_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION ''sku % not found'', p_sku_id;
  END IF;

  INSERT INTO public.posting_intent (
    target_system, action, entity_type, entity_id, idempotency_key, status, payload
  )
  VALUES (
    ''qbo'', ''upsert_item'', ''sku'', p_sku_id,
    ''qbo:upsert_item:'' || p_sku_id::text, ''pending'',
    jsonb_build_object(
      ''sku_id'', p_sku_id,
      ''sku_code'', v_sku.sku_code,
      ''old_sku_code'', p_old_sku_code,
      ''purchase_cost'', p_purchase_cost,
      ''supplier_vat_registered'', p_supplier_vat_registered,
      ''queued_at'', now()
    )
  )
  ON CONFLICT (target_system, action, idempotency_key) DO UPDATE
  SET payload = EXCLUDED.payload,
      status = CASE WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN ''pending'' ELSE posting_intent.status END,
      next_attempt_at = CASE WHEN posting_intent.status IN (''failed'', ''cancelled'', ''posted'') THEN now() ELSE posting_intent.next_attempt_at END,
      updated_at = now()
  RETURNING id INTO v_intent_id;

  RETURN v_intent_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_qbo_item_posting_intent(UUID, TEXT, NUMERIC, BOOLEAN) TO authenticated, service_role;
COMMENT ON FUNCTION public.queue_qbo_item_posting_intent(UUID, TEXT, NUMERIC, BOOLEAN) IS
  'Queues an idempotent QBO Item upsert intent for asynchronous processing.';