WITH historic_orders AS (
  SELECT so.id
  FROM public.sales_order so
  WHERE COALESCE(so.txn_date, so.created_at::date) < DATE '2026-04-28'
    AND so.status NOT IN ('cancelled', 'refunded')
),
expected_totals AS (
  SELECT
    ho.id AS sales_order_id,
    ROUND(COALESCE(SUM(esl.amount), 0), 2) AS expected_total
  FROM historic_orders ho
  LEFT JOIN public.expected_settlement_line esl
    ON esl.sales_order_id = ho.id
  GROUP BY ho.id
),
order_fallback_totals AS (
  SELECT
    et.sales_order_id,
    CASE
      WHEN et.expected_total <> 0 THEN et.expected_total
      ELSE ROUND(COALESCE(so.gross_total, 0), 2)
    END AS paid_out_total
  FROM expected_totals et
  JOIN public.sales_order so ON so.id = et.sales_order_id
)
INSERT INTO public.actual_settlement_line (
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
  oft.sales_order_id,
  'manual_backfill',
  'net',
  oft.paid_out_total,
  COALESCE(so.currency, 'GBP'),
  so.order_number,
  'actual:manual_paid_out_pre_2026_04_28:' || oft.sales_order_id::text,
  jsonb_build_object(
    'reason', 'mark_pre_2026_04_28_orders_paid_out',
    'cutoff_date_exclusive', '2026-04-28',
    'source', 'migration'
  ),
  COALESCE(so.txn_date::timestamptz, so.created_at, now())
FROM order_fallback_totals oft
JOIN public.sales_order so ON so.id = oft.sales_order_id
WHERE oft.paid_out_total <> 0
ON CONFLICT (idempotency_key) DO UPDATE
SET amount = EXCLUDED.amount,
    currency = EXCLUDED.currency,
    external_reference = EXCLUDED.external_reference,
    metadata = EXCLUDED.metadata,
    occurred_at = EXCLUDED.occurred_at;

WITH historic_orders AS (
  SELECT so.id
  FROM public.sales_order so
  WHERE COALESCE(so.txn_date, so.created_at::date) < DATE '2026-04-28'
    AND so.status NOT IN ('cancelled', 'refunded')
)
UPDATE public.stock_unit su
SET v2_status = 'payout_received',
    updated_at = now()
FROM public.sales_order_line sol
JOIN historic_orders ho ON ho.id = sol.sales_order_id
WHERE su.id = sol.stock_unit_id
  AND su.v2_status IN ('sold', 'shipped', 'delivered');

WITH historic_orders AS (
  SELECT so.id
  FROM public.sales_order so
  WHERE COALESCE(so.txn_date, so.created_at::date) < DATE '2026-04-28'
    AND so.status NOT IN ('cancelled', 'refunded')
)
UPDATE public.sales_order so
SET v2_status = 'complete',
    status = CASE
      WHEN so.status IN ('pending_payment', 'authorised', 'paid', 'picking', 'packed', 'awaiting_dispatch', 'shipped') THEN 'complete'
      ELSE so.status
    END,
    updated_at = now()
FROM historic_orders ho
WHERE so.id = ho.id
  AND COALESCE(so.v2_status::text, '') <> 'return_pending';

UPDATE public.reconciliation_case rc
SET status = 'resolved',
    close_code = 'paid_out_backfill',
    closed_at = now(),
    evidence = rc.evidence || jsonb_build_object(
      'resolution_note', 'Resolved by paid-out backfill for orders before 2026-04-28',
      'resolution_source', 'migration',
      'resolved_at', now()
    ),
    updated_at = now()
WHERE rc.sales_order_id IN (
    SELECT so.id
    FROM public.sales_order so
    WHERE COALESCE(so.txn_date, so.created_at::date) < DATE '2026-04-28'
      AND so.status NOT IN ('cancelled', 'refunded')
  )
  AND rc.status IN ('open', 'in_progress')
  AND rc.case_type IN ('missing_payout', 'amount_mismatch');