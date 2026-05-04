-- Record approved pricing overrides against immutable price decision snapshots.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar quotes.

CREATE OR REPLACE FUNCTION public.record_price_override_approval(
  p_price_decision_snapshot_id UUID,
  p_reason_code TEXT,
  p_reason_note TEXT DEFAULT NULL,
  p_approved_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_snapshot public.price_decision_snapshot%ROWTYPE;
  v_override_id UUID;
  v_actor UUID := COALESCE(p_approved_by, auth.uid());
  v_reason_code TEXT := NULLIF(trim(COALESCE(p_reason_code, '''')), '''');
BEGIN
  IF NOT public.subledger_staff_read_policy() THEN
    RAISE EXCEPTION ''Not authorized to approve price overrides'';
  END IF;

  IF v_reason_code IS NULL THEN
    RAISE EXCEPTION ''Price override reason code is required'';
  END IF;

  SELECT * INTO v_snapshot
  FROM public.price_decision_snapshot
  WHERE id = p_price_decision_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Price decision snapshot % not found'', p_price_decision_snapshot_id;
  END IF;

  IF NOT COALESCE(v_snapshot.override_required, false) THEN
    RAISE EXCEPTION ''Price decision snapshot % does not require an override'', p_price_decision_snapshot_id;
  END IF;

  INSERT INTO public.price_override (
    price_decision_snapshot_id,
    sku_id,
    channel_listing_id,
    channel,
    override_type,
    old_price,
    new_price,
    reason_code,
    reason_note,
    approved_by,
    performed_by
  )
  VALUES (
    v_snapshot.id,
    v_snapshot.sku_id,
    v_snapshot.channel_listing_id,
    v_snapshot.channel,
    CASE
      WHEN COALESCE(v_snapshot.candidate_price, 0) < COALESCE(v_snapshot.floor_price, 0) THEN ''below_floor''
      ELSE ''margin_exception''
    END,
    v_snapshot.current_price,
    v_snapshot.candidate_price,
    v_reason_code,
    NULLIF(trim(COALESCE(p_reason_note, '''')), ''''),
    v_actor,
    auth.uid()
  )
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
';

GRANT EXECUTE ON FUNCTION public.record_price_override_approval(UUID, TEXT, TEXT, UUID)
TO authenticated, service_role;
