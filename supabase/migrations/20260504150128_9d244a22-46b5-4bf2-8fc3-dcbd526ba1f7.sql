ALTER TABLE public.channel_listing
  ADD COLUMN IF NOT EXISTS availability_override text,
  ADD COLUMN IF NOT EXISTS availability_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_override_by uuid;

ALTER TABLE public.channel_listing
  DROP CONSTRAINT IF EXISTS channel_listing_availability_override_check;

ALTER TABLE public.channel_listing
  ADD CONSTRAINT channel_listing_availability_override_check
  CHECK (
    availability_override IS NULL
    OR availability_override = 'manual_out_of_stock'
  );

CREATE INDEX IF NOT EXISTS idx_channel_listing_manual_oos
  ON public.channel_listing(sku_id, channel)
  WHERE availability_override = 'manual_out_of_stock';

CREATE OR REPLACE FUNCTION public.queue_listing_command(
  p_channel_listing_id UUID,
  p_command_type TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_allow_below_floor BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_listing public.channel_listing%ROWTYPE;
  v_snapshot public.price_decision_snapshot%ROWTYPE;
  v_command_id UUID;
  v_target TEXT;
  v_available_quantity INTEGER := NULL;
  v_quantity_marker TEXT;
  v_idempotency_key TEXT;
BEGIN
  SELECT * INTO v_listing FROM public.channel_listing WHERE id = p_channel_listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''channel_listing % not found'', p_channel_listing_id;
  END IF;

  IF p_command_type NOT IN (''publish'', ''reprice'', ''pause'', ''end'', ''update_price'', ''sync_quantity'') THEN
    RAISE EXCEPTION ''Unsupported listing command type %'', p_command_type;
  END IF;

  IF p_command_type <> ''sync_quantity''
     AND v_listing.current_price_decision_snapshot_id IS NULL
     AND v_listing.sku_id IS NOT NULL THEN
    PERFORM public.create_price_decision_snapshot(
      v_listing.sku_id,
      COALESCE(v_listing.channel, v_listing.v2_channel::text, ''website''),
      v_listing.id, v_listing.listed_price, NULL, p_actor_id);
  END IF;

  SELECT * INTO v_snapshot FROM public.price_decision_snapshot
  WHERE id = (SELECT current_price_decision_snapshot_id FROM public.channel_listing WHERE id = p_channel_listing_id);

  IF p_command_type IN (''publish'', ''reprice'', ''update_price'')
     AND COALESCE(v_snapshot.override_required, false)
     AND NOT p_allow_below_floor THEN
    RAISE EXCEPTION ''Listing command blocked: price decision requires override (%).'', v_snapshot.blocking_reasons;
  END IF;

  IF p_command_type = ''sync_quantity'' THEN
    IF v_listing.sku_id IS NULL THEN
      RAISE EXCEPTION ''Cannot sync quantity for listing % without sku_id'', p_channel_listing_id;
    END IF;

    IF v_listing.availability_override = ''manual_out_of_stock'' THEN
      v_available_quantity := 0;
    ELSE
      SELECT COUNT(*)::integer INTO v_available_quantity
      FROM public.stock_unit su
      WHERE su.sku_id = v_listing.sku_id
        AND su.v2_status IN (''graded'', ''listed'', ''restocked'');
    END IF;

    v_quantity_marker := COALESCE(v_listing.availability_override_at, v_listing.synced_at, v_listing.updated_at, now())::text;

    v_idempotency_key := p_command_type
      || '':channel_listing:'' || p_channel_listing_id::text
      || '':qty:'' || COALESCE(v_available_quantity, 0)::text
      || '':override:'' || COALESCE(v_listing.availability_override, ''auto'')
      || '':marker:'' || v_quantity_marker;
  ELSE
    v_idempotency_key := p_command_type || '':channel_listing:'' || p_channel_listing_id::text || '':'' || COALESCE(v_snapshot.id::text, ''no_snapshot'');
  END IF;

  v_target := COALESCE(v_listing.channel, v_listing.v2_channel::text, ''website'');

  INSERT INTO public.outbound_command (target_system, command_type, entity_type, entity_id, idempotency_key, status, payload)
  VALUES (v_target, p_command_type, ''channel_listing'', p_channel_listing_id, v_idempotency_key, ''pending'',
    jsonb_build_object(
      ''channel_listing_id'', p_channel_listing_id,
      ''price_decision_snapshot_id'', v_snapshot.id,
      ''actor_id'', p_actor_id,
      ''listed_price'', v_listing.listed_price,
      ''listed_quantity'', COALESCE(v_available_quantity, v_listing.listed_quantity),
      ''availability_override'', v_listing.availability_override,
      ''availability_override_at'', v_listing.availability_override_at,
      ''sku_id'', v_listing.sku_id))
  ON CONFLICT (target_system, command_type, idempotency_key) DO UPDATE
  SET status = CASE WHEN public.outbound_command.status IN (''failed'', ''cancelled'') THEN ''pending'' ELSE public.outbound_command.status END,
      next_attempt_at = CASE WHEN public.outbound_command.status IN (''failed'', ''cancelled'') THEN now() ELSE public.outbound_command.next_attempt_at END,
      payload = EXCLUDED.payload, updated_at = now()
  RETURNING id INTO v_command_id;

  RETURN v_command_id;
END;
';

GRANT EXECUTE ON FUNCTION public.queue_listing_command(UUID, TEXT, UUID, BOOLEAN)
TO authenticated, service_role;