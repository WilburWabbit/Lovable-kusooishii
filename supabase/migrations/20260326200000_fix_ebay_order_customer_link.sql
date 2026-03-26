-- ============================================================
-- Fix: Link orphaned eBay orders to customer records
--
-- eBay orders created with customer_id = NULL because the
-- customer insert error was silently ignored. This backfill:
-- 1. Creates missing customer records from order guest_name/email
-- 2. Links orphaned orders to their customer records
-- ============================================================

BEGIN;

-- Step 1: Create customer records for eBay buyers that don't exist yet
INSERT INTO public.customer (display_name, email, channel_ids)
SELECT DISTINCT
  so.guest_name,
  so.guest_email,
  '{}'::jsonb
FROM public.sales_order so
WHERE so.customer_id IS NULL
  AND so.origin_channel = 'ebay'
  AND so.guest_name IS NOT NULL
  AND so.guest_name != ''
  AND NOT EXISTS (
    SELECT 1 FROM public.customer c WHERE c.display_name = so.guest_name
  )
ON CONFLICT DO NOTHING;

-- Step 2: Link orphaned eBay orders to their customer records
UPDATE public.sales_order so
SET customer_id = c.id
FROM public.customer c
WHERE so.customer_id IS NULL
  AND so.origin_channel = 'ebay'
  AND so.guest_name IS NOT NULL
  AND so.guest_name != ''
  AND c.display_name = so.guest_name;

COMMIT;
