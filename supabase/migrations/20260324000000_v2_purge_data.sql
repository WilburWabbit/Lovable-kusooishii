-- ============================================================
-- Admin V2 — Purge All V2 Data
-- Clears all v2 data (both migrated/backfilled and new entries)
-- while preserving the v2 schema and all v1 data intact.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Clear stock_unit v2 columns (must go first — unblocks FK deletes)
-- ─────────────────────────────────────────────────────────────

UPDATE public.stock_unit SET
  uid = NULL,
  batch_id = NULL,
  line_item_id = NULL,
  condition_flags = NULL,
  v2_status = NULL,
  order_id = NULL,
  payout_id = NULL,
  graded_at = NULL,
  listed_at = NULL,
  sold_at = NULL,
  shipped_at = NULL,
  delivered_at = NULL,
  completed_at = NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. Clear v2 columns on sku
-- ─────────────────────────────────────────────────────────────

UPDATE public.sku SET
  sale_price = NULL,
  floor_price = NULL,
  avg_cost = NULL,
  cost_range = NULL,
  condition_notes = NULL,
  market_price = NULL,
  mpn = NULL,
  v2_markdown_applied = NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Clear v2 columns on sales_order
-- ─────────────────────────────────────────────────────────────

UPDATE public.sales_order SET
  v2_status = NULL,
  payment_method = NULL,
  vat_amount = NULL,
  net_amount = NULL,
  blue_bell_club = false,
  external_order_id = NULL,
  carrier = NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. Clear v2 columns on sales_order_line
-- ─────────────────────────────────────────────────────────────

UPDATE public.sales_order_line SET cogs = NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. Clear v2 columns on channel_listing
-- ─────────────────────────────────────────────────────────────

UPDATE public.channel_listing SET
  external_url = NULL,
  v2_status = NULL,
  v2_channel = NULL,
  fee_adjusted_price = NULL,
  estimated_fees = NULL,
  estimated_net = NULL,
  listed_at = NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. Clear v2 columns on customer
-- ─────────────────────────────────────────────────────────────

UPDATE public.customer SET
  channel_ids = NULL,
  blue_bell_member = false;

-- ─────────────────────────────────────────────────────────────
-- 7. Clear v2 columns on product
-- ─────────────────────────────────────────────────────────────

UPDATE public.product SET
  ean = NULL,
  set_number = NULL,
  dimensions_cm = NULL,
  weight_g = NULL,
  age_mark = NULL;

-- ─────────────────────────────────────────────────────────────
-- 8. Delete v2-only table data (dependency order)
-- ─────────────────────────────────────────────────────────────

DELETE FROM public.payout_orders;
DELETE FROM public.landing_raw_ebay_payout;
DELETE FROM public.payouts;
DELETE FROM public.purchase_line_items;
DELETE FROM public.purchase_batches;

-- ─────────────────────────────────────────────────────────────
-- 9. Reset PO sequence so next batch starts at PO-001
-- ─────────────────────────────────────────────────────────────

SELECT setval('public.purchase_batch_seq', 1, false);

COMMIT;
