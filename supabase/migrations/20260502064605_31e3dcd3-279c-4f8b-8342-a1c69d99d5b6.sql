-- ============================================================
-- One-shot reconciliation: clear stale needs_allocation orders
-- left behind by the v2 commerce subledger refactor.
-- ============================================================

-- 1. KO-0009504: 3 of 4 lines reference units now in payout_received.
--    Promote the order to complete.
UPDATE public.sales_order
SET v2_status = 'complete',
    updated_at = now()
WHERE order_number = 'KO-0009504'
  AND v2_status = 'needs_allocation';

-- 2. The 13 fully-unallocated historical orders. These are old (2024-12 → 2026-04)
--    and were fulfilled outside the v2 pipeline; option B = mark complete.
UPDATE public.sales_order
SET v2_status = 'complete',
    updated_at = now()
WHERE v2_status = 'needs_allocation'
  AND id IN (
    SELECT so.id
    FROM public.sales_order so
    LEFT JOIN public.sales_order_line sol ON sol.sales_order_id = so.id
    WHERE so.v2_status = 'needs_allocation'
    GROUP BY so.id
    HAVING COUNT(sol.id) > 0
       AND COUNT(sol.stock_unit_id) = 0
  );

-- 3. Forward guard: any remaining order whose every line points to a stock_unit
--    that has already been sold / paid out / restocked is, by definition, fulfilled.
--    Promote them to complete to prevent the same drift recurring after future
--    subledger migrations.
UPDATE public.sales_order so
SET v2_status = 'complete',
    updated_at = now()
WHERE so.v2_status = 'needs_allocation'
  AND EXISTS (
    SELECT 1 FROM public.sales_order_line sol WHERE sol.sales_order_id = so.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.sales_order_line sol
    LEFT JOIN public.stock_unit su ON su.id = sol.stock_unit_id
    WHERE sol.sales_order_id = so.id
      AND (
        sol.stock_unit_id IS NULL
        OR su.v2_status NOT IN ('sold', 'payout_received', 'restocked')
      )
  );
