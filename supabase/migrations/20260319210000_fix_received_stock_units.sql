-- Fix stock units stuck in 'received' status.
-- These were created by qbo-sync-purchases with status='received' instead of 'available'.
-- Since no code path transitions 'received' → 'available', they are invisible to
-- QtyOnHand reconciliation and sales allocation, causing stock level divergence with QBO.

UPDATE public.stock_unit
SET status = 'available',
    updated_at = now()
WHERE status = 'received'
  AND sku_id IS NOT NULL;
