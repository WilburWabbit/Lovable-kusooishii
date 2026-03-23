-- ============================================================
-- Admin V2 — Data Backfill Migration
-- Populates v2 columns and tables from existing v1 data.
-- Safe to re-run: all operations use IF NOT EXISTS / WHERE guards.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Create a "Legacy Import" purchase batch for all pre-v2 stock
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.purchase_batches (id, supplier_name, purchase_date, reference, supplier_vat_registered, shared_costs, total_shared_costs, status, unit_counter, created_at)
SELECT
  'PO-000',
  'Legacy Import',
  CURRENT_DATE,
  'Backfill from v1 data',
  false,
  '{"shipping": 0, "broker_fee": 0, "other": 0}'::jsonb,
  0,
  'recorded',
  0,
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.purchase_batches WHERE id = 'PO-000');

-- ─────────────────────────────────────────────────────────────
-- 1. Create purchase line items — one per MPN with existing stock
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.purchase_line_items (batch_id, mpn, quantity, unit_cost, apportioned_cost, landed_cost_per_unit)
SELECT
  'PO-000',
  su.mpn,
  COUNT(*)::integer,
  COALESCE(AVG(su.landed_cost), 0),
  0,
  COALESCE(AVG(su.landed_cost), 0)
FROM public.stock_unit su
WHERE su.mpn IS NOT NULL
  AND su.batch_id IS NULL  -- only backfill units not already in a v2 batch
GROUP BY su.mpn
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. Backfill stock_unit v2 columns
-- ─────────────────────────────────────────────────────────────

-- 2a. Link to legacy batch and line items
UPDATE public.stock_unit su
SET
  batch_id = 'PO-000',
  line_item_id = pli.id
FROM public.purchase_line_items pli
WHERE pli.batch_id = 'PO-000'
  AND pli.mpn = su.mpn
  AND su.batch_id IS NULL;

-- 2b. Generate UIDs for units that don't have one
-- Format: LI-{seq} (Legacy Import prefix to distinguish from PO-generated UIDs)
UPDATE public.stock_unit su
SET uid = 'LI-' || lpad(rn::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.stock_unit
  WHERE uid IS NULL
) numbered
WHERE su.id = numbered.id
  AND su.uid IS NULL;

-- 2c. Map v1 status → v2_status
-- v1 statuses: pending_receipt, received, awaiting_grade, graded, available,
--              reserved, allocated, picked, packed, shipped, delivered,
--              returned, awaiting_disposition, scrap, part_out, written_off, closed
UPDATE public.stock_unit
SET v2_status = CASE
  -- Pre-grading states
  WHEN status IN ('pending_receipt', 'received', 'awaiting_grade')
    THEN 'purchased'::v2_unit_status

  -- Graded but not yet listed
  WHEN status = 'graded'
    THEN 'graded'::v2_unit_status

  -- Available = graded + listed for sale
  WHEN status = 'available'
    THEN 'listed'::v2_unit_status

  -- Reserved/allocated/picked/packed = sold (order in progress)
  WHEN status IN ('reserved', 'allocated', 'picked', 'packed')
    THEN 'sold'::v2_unit_status

  -- Shipped
  WHEN status = 'shipped'
    THEN 'shipped'::v2_unit_status

  -- Delivered
  WHEN status = 'delivered'
    THEN 'delivered'::v2_unit_status

  -- Terminal / closed
  WHEN status IN ('closed', 'scrap', 'part_out', 'written_off')
    THEN 'complete'::v2_unit_status

  -- Returns
  WHEN status IN ('returned', 'awaiting_disposition')
    THEN 'return_pending'::v2_unit_status

  -- Fallback: if graded, mark graded; otherwise purchased
  ELSE CASE
    WHEN condition_grade IS NOT NULL THEN 'graded'::v2_unit_status
    ELSE 'purchased'::v2_unit_status
  END
END
WHERE v2_status IS NULL;

-- 2d. Populate lifecycle timestamps from available data
UPDATE public.stock_unit
SET
  graded_at = CASE
    WHEN condition_grade IS NOT NULL AND graded_at IS NULL
    THEN COALESCE(updated_at, created_at)
    ELSE graded_at
  END,
  listed_at = CASE
    WHEN status = 'available' AND listed_at IS NULL
    THEN COALESCE(updated_at, created_at)
    ELSE listed_at
  END,
  sold_at = CASE
    WHEN status IN ('reserved', 'allocated', 'picked', 'packed', 'shipped', 'delivered', 'closed') AND sold_at IS NULL
    THEN updated_at
    ELSE sold_at
  END,
  shipped_at = CASE
    WHEN status IN ('shipped', 'delivered', 'closed') AND shipped_at IS NULL
    THEN updated_at
    ELSE shipped_at
  END,
  delivered_at = CASE
    WHEN status IN ('delivered', 'closed') AND delivered_at IS NULL
    THEN updated_at
    ELSE delivered_at
  END
WHERE v2_status IS NOT NULL;

-- 2e. Link stock units to orders via sales_order_line
UPDATE public.stock_unit su
SET order_id = sol.sales_order_id
FROM public.sales_order_line sol
WHERE sol.stock_unit_id = su.id
  AND su.order_id IS NULL;

-- 2f. Update the legacy batch unit_counter
UPDATE public.purchase_batches
SET unit_counter = (
  SELECT COUNT(*) FROM public.stock_unit WHERE batch_id = 'PO-000'
)
WHERE id = 'PO-000';

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill sku v2 columns
-- ─────────────────────────────────────────────────────────────

-- 3a. Denormalise mpn from product
UPDATE public.sku s
SET mpn = p.mpn
FROM public.product p
WHERE s.product_id = p.id
  AND s.mpn IS NULL;

-- 3b. Populate sale_price from existing price column
UPDATE public.sku
SET sale_price = price
WHERE sale_price IS NULL
  AND price IS NOT NULL;

-- 3c. Calculate avg_cost from stock units on hand
UPDATE public.sku s
SET avg_cost = sub.avg_landed
FROM (
  SELECT su.sku_id, AVG(su.landed_cost) AS avg_landed
  FROM public.stock_unit su
  WHERE su.landed_cost IS NOT NULL
    AND su.v2_status IN ('graded', 'listed')
  GROUP BY su.sku_id
) sub
WHERE s.id = sub.sku_id
  AND s.avg_cost IS NULL;

-- 3d. Calculate floor_price = max landed cost × 1.25
UPDATE public.sku s
SET floor_price = sub.max_landed * 1.25
FROM (
  SELECT su.sku_id, MAX(su.landed_cost) AS max_landed
  FROM public.stock_unit su
  WHERE su.landed_cost IS NOT NULL
    AND su.v2_status IN ('graded', 'listed')
  GROUP BY su.sku_id
) sub
WHERE s.id = sub.sku_id
  AND s.floor_price IS NULL;

-- 3e. Calculate cost_range
UPDATE public.sku s
SET cost_range = '£' || sub.min_cost::text || '–£' || sub.max_cost::text
FROM (
  SELECT su.sku_id,
    MIN(su.landed_cost) AS min_cost,
    MAX(su.landed_cost) AS max_cost
  FROM public.stock_unit su
  WHERE su.landed_cost IS NOT NULL
    AND su.v2_status IN ('graded', 'listed')
  GROUP BY su.sku_id
) sub
WHERE s.id = sub.sku_id
  AND s.cost_range IS NULL;

-- 3f. Populate market_price from brickeconomy_collection if available
-- brickeconomy_collection uses item_number (e.g. '75367-1'), not mpn
UPDATE public.sku s
SET market_price = bec.current_value
FROM public.product p
JOIN public.brickeconomy_collection bec ON bec.item_number = p.mpn
WHERE s.product_id = p.id
  AND s.market_price IS NULL
  AND bec.current_value IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. Backfill sales_order v2 columns
-- ─────────────────────────────────────────────────────────────

-- 4a. Map v1 order status → v2_status
UPDATE public.sales_order
SET v2_status = CASE
  WHEN status IN ('pending_payment', 'authorised')
    THEN 'new'::v2_order_status
  WHEN status = 'paid'
    THEN 'new'::v2_order_status
  WHEN status IN ('picking', 'packed', 'awaiting_dispatch')
    THEN 'awaiting_shipment'::v2_order_status
  WHEN status = 'shipped'
    THEN 'shipped'::v2_order_status
  WHEN status = 'complete'
    THEN 'complete'::v2_order_status
  WHEN status IN ('partially_refunded', 'refunded')
    THEN 'return_pending'::v2_order_status
  WHEN status = 'cancelled'
    THEN 'complete'::v2_order_status
  WHEN status = 'exception'
    THEN 'needs_allocation'::v2_order_status
  ELSE 'new'::v2_order_status
END
WHERE v2_status IS NULL;

-- 4b. Calculate VAT amounts (UK 20% VAT inclusive)
UPDATE public.sales_order
SET
  vat_amount = ROUND(gross_total / 6, 2),
  net_amount = gross_total - ROUND(gross_total / 6, 2)
WHERE vat_amount IS NULL
  AND gross_total IS NOT NULL
  AND gross_total > 0;

-- 4c. Derive payment_method from origin_channel
UPDATE public.sales_order
SET payment_method = CASE
  WHEN origin_channel = 'ebay' THEN 'ebay_managed'
  WHEN origin_channel = 'web' THEN 'stripe'
  WHEN origin_channel = 'bricklink' THEN 'bricklink_managed'
  WHEN origin_channel = 'in_person' THEN 'cash'
  ELSE 'stripe'
END
WHERE payment_method IS NULL;

-- 4d. Set blue_bell_club from club_id
UPDATE public.sales_order
SET blue_bell_club = true
WHERE club_id IS NOT NULL
  AND blue_bell_club = false;

-- 4e. Populate external_order_id from origin_reference
UPDATE public.sales_order
SET external_order_id = origin_reference
WHERE external_order_id IS NULL
  AND origin_reference IS NOT NULL
  AND origin_reference != '';

-- ─────────────────────────────────────────────────────────────
-- 5. Backfill sales_order_line.cogs from stock unit landed cost
-- ─────────────────────────────────────────────────────────────

UPDATE public.sales_order_line sol
SET cogs = su.landed_cost
FROM public.stock_unit su
WHERE sol.stock_unit_id = su.id
  AND sol.cogs IS NULL
  AND su.landed_cost IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. Backfill channel_listing v2 columns
-- ─────────────────────────────────────────────────────────────

-- 6a. Map channel text → v2_channel enum
UPDATE public.channel_listing
SET v2_channel = CASE
  WHEN lower(channel) = 'ebay' THEN 'ebay'::v2_channel
  WHEN lower(channel) IN ('website', 'web') THEN 'website'::v2_channel
  WHEN lower(channel) = 'bricklink' THEN 'bricklink'::v2_channel
  WHEN lower(channel) = 'brickowl' THEN 'brickowl'::v2_channel
  WHEN lower(channel) = 'in_person' THEN 'in_person'::v2_channel
  ELSE 'website'::v2_channel
END
WHERE v2_channel IS NULL;

-- 6b. Map offer_status → v2_status
UPDATE public.channel_listing
SET v2_status = CASE
  WHEN lower(offer_status) IN ('active', 'live', 'published') THEN 'live'::v2_channel_listing_status
  WHEN lower(offer_status) IN ('ended', 'closed', 'sold') THEN 'ended'::v2_channel_listing_status
  WHEN lower(offer_status) IN ('paused', 'inactive') THEN 'paused'::v2_channel_listing_status
  ELSE 'draft'::v2_channel_listing_status
END
WHERE v2_status IS NULL;

-- 6c. Construct external_url for eBay listings
UPDATE public.channel_listing
SET external_url = 'https://www.ebay.co.uk/itm/' || external_listing_id
WHERE external_url IS NULL
  AND external_listing_id IS NOT NULL
  AND lower(channel) = 'ebay';

-- ─────────────────────────────────────────────────────────────
-- 7. Backfill customer v2 columns
-- ─────────────────────────────────────────────────────────────

-- 7a. Mark Blue Bell members based on order history
UPDATE public.customer c
SET blue_bell_member = true
WHERE EXISTS (
  SELECT 1 FROM public.sales_order so
  WHERE so.customer_id = c.id
    AND so.club_id IS NOT NULL
)
AND c.blue_bell_member = false;

-- ─────────────────────────────────────────────────────────────
-- 8. Advance the PO sequence past PO-000 so new batches start at PO-001
-- ─────────────────────────────────────────────────────────────

-- Ensure the sequence is at least at 1 so next batch will be PO-001
SELECT setval('public.purchase_batch_seq', GREATEST(
  (SELECT last_value FROM public.purchase_batch_seq),
  1
));

COMMIT;
