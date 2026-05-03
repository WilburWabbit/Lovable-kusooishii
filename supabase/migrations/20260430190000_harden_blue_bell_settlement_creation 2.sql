-- Harden sales-program settlement creation so dashboard/admin retries do not
-- attach already-settled accruals to duplicate draft settlements.
-- Lovable SQL runner note: use single-quoted PL/pgSQL bodies, not dollar-quoted delimiters.

CREATE OR REPLACE FUNCTION public.create_sales_program_settlement(
  p_program_code TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_actor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_program_id UUID;
  v_settlement_id UUID;
  v_accrual_count INTEGER := 0;
BEGIN
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION ''Settlement period end must be on or after start'';
  END IF;

  SELECT id INTO v_program_id
  FROM public.sales_program
  WHERE program_code = p_program_code;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION ''sales_program % not found'', p_program_code;
  END IF;

  SELECT COUNT(*) INTO v_accrual_count
  FROM public.sales_program_accrual spa
  JOIN public.sales_order so ON so.id = spa.sales_order_id
  WHERE spa.sales_program_id = v_program_id
    AND spa.status = ''open''
    AND spa.settlement_id IS NULL
    AND so.created_at::date BETWEEN p_period_start AND p_period_end;

  IF v_accrual_count = 0 THEN
    RAISE EXCEPTION ''No open unsettled accruals found for % between % and %'',
      p_program_code, p_period_start, p_period_end;
  END IF;

  INSERT INTO public.sales_program_settlement (
    sales_program_id,
    period_start,
    period_end,
    status,
    gross_sales_amount,
    discount_amount,
    commission_amount,
    reversed_amount,
    notes,
    created_by
  )
  SELECT
    v_program_id,
    p_period_start,
    p_period_end,
    ''draft'',
    COALESCE(SUM(so.gross_total), 0),
    COALESCE(SUM(spa.discount_amount), 0),
    COALESCE(SUM(spa.commission_amount), 0),
    COALESCE(SUM(spa.reversed_amount), 0),
    p_notes,
    p_actor_id
  FROM public.sales_program_accrual spa
  JOIN public.sales_order so ON so.id = spa.sales_order_id
  WHERE spa.sales_program_id = v_program_id
    AND spa.status = ''open''
    AND spa.settlement_id IS NULL
    AND so.created_at::date BETWEEN p_period_start AND p_period_end
  RETURNING id INTO v_settlement_id;

  UPDATE public.sales_program_accrual spa
  SET settlement_id = v_settlement_id,
      status = ''partially_settled'',
      updated_at = now()
  FROM public.sales_order so
  WHERE so.id = spa.sales_order_id
    AND spa.sales_program_id = v_program_id
    AND spa.status = ''open''
    AND spa.settlement_id IS NULL
    AND so.created_at::date BETWEEN p_period_start AND p_period_end;

  RETURN v_settlement_id;
END;
';

GRANT EXECUTE ON FUNCTION public.create_sales_program_settlement(TEXT, DATE, DATE, UUID, TEXT)
TO authenticated, service_role;
