-- Repair orders incorrectly flagged as needs_allocation when all lines are allocated
UPDATE public.sales_order so
SET v2_status = 'new'
WHERE so.v2_status = 'needs_allocation'
  AND EXISTS (SELECT 1 FROM public.sales_order_line sol WHERE sol.sales_order_id = so.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sales_order_line sol
    WHERE sol.sales_order_id = so.id AND sol.stock_unit_id IS NULL
  );