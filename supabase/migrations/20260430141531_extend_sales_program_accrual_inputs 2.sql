-- Allow checkout and staff sale flows to pass the exact programme amounts while
-- keeping legacy Blue Bell compatibility fields owned by the domain RPC.

DROP FUNCTION IF EXISTS public.record_sales_program_accrual(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.record_sales_program_accrual(
  p_sales_order_id UUID,
  p_program_code TEXT DEFAULT 'blue_bell',
  p_attribution_source TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_basis_amount NUMERIC DEFAULT NULL,
  p_discount_amount NUMERIC DEFAULT NULL,
  p_commission_amount NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id UUID;
  v_attribution_id UUID;
  v_order public.sales_order%ROWTYPE;
  v_basis NUMERIC;
  v_discount NUMERIC;
  v_commission NUMERIC;
  v_accrual_id UUID;
BEGIN
  SELECT id INTO v_program_id
  FROM public.sales_program
  WHERE program_code = p_program_code
    AND status = 'active';

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'Sales program % is not active or does not exist', p_program_code;
  END IF;

  SELECT * INTO v_order FROM public.sales_order WHERE id = p_sales_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order % not found', p_sales_order_id;
  END IF;

  INSERT INTO public.sales_program_attribution (
    sales_order_id,
    sales_program_id,
    attribution_source,
    actor_id,
    locked_at
  )
  VALUES (p_sales_order_id, v_program_id, p_attribution_source, p_actor_id, now())
  ON CONFLICT (sales_order_id, sales_program_id) DO UPDATE
  SET attribution_source = EXCLUDED.attribution_source,
      actor_id = EXCLUDED.actor_id
  RETURNING id INTO v_attribution_id;

  SELECT
    ROUND(COALESCE(
      p_basis_amount,
      GREATEST(COALESCE(v_order.merchandise_subtotal, v_order.gross_total, 0) - COALESCE(v_order.discount_total, 0), 0)
    ), 2),
    ROUND(COALESCE(
      p_discount_amount,
      NULLIF(v_order.club_discount_amount, 0),
      COALESCE(v_order.merchandise_subtotal, 0) * sp.default_discount_rate
    ), 2),
    ROUND(COALESCE(
      p_commission_amount,
      NULLIF(v_order.club_commission_amount, 0),
      GREATEST(COALESCE(v_order.merchandise_subtotal, v_order.gross_total, 0) - COALESCE(v_order.discount_total, 0), 0) * sp.default_commission_rate
    ), 2)
  INTO v_basis, v_discount, v_commission
  FROM public.sales_program sp
  WHERE sp.id = v_program_id;

  INSERT INTO public.sales_program_accrual (
    sales_program_id,
    sales_order_id,
    attribution_id,
    accrual_type,
    basis_amount,
    discount_amount,
    commission_amount,
    currency,
    status,
    source
  )
  VALUES (
    v_program_id,
    p_sales_order_id,
    v_attribution_id,
    'commission',
    v_basis,
    v_discount,
    v_commission,
    COALESCE(v_order.currency, 'GBP'),
    'open',
    p_attribution_source
  )
  ON CONFLICT (sales_program_id, sales_order_id, accrual_type) DO UPDATE
  SET attribution_id = EXCLUDED.attribution_id,
      basis_amount = EXCLUDED.basis_amount,
      discount_amount = EXCLUDED.discount_amount,
      commission_amount = EXCLUDED.commission_amount,
      updated_at = now()
  RETURNING id INTO v_accrual_id;

  UPDATE public.sales_order
  SET blue_bell_club = CASE WHEN p_program_code = 'blue_bell' THEN true ELSE blue_bell_club END,
      club_discount_amount = CASE WHEN p_program_code = 'blue_bell' THEN v_discount ELSE club_discount_amount END,
      club_commission_amount = CASE WHEN p_program_code = 'blue_bell' THEN v_commission ELSE club_commission_amount END
  WHERE id = p_sales_order_id;

  RETURN v_accrual_id;
END;
$$;
