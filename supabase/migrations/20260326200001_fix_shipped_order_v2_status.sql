-- ============================================================
-- Fix: Sync v2_status for shipped orders and their stock units
--
-- The process_shipment handler was updating sales_order.status
-- to 'shipped' but not v2_status. This backfill corrects
-- existing orders and their linked stock units.
-- ============================================================

BEGIN;

-- Fix sales_order v2_status for orders already shipped in v1
UPDATE public.sales_order
SET v2_status = 'shipped'::v2_order_status
WHERE status = 'shipped'
  AND (v2_status IS NULL OR v2_status = 'new');

-- Fix stock units linked to shipped orders
UPDATE public.stock_unit su
SET v2_status = 'shipped',
    shipped_at = COALESCE(so.shipped_date, so.updated_at, now())
FROM public.sales_order so
WHERE su.order_id = so.id
  AND so.v2_status = 'shipped'
  AND su.v2_status IN ('sold', 'listed', 'graded');

COMMIT;
