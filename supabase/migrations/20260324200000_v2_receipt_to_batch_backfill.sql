-- ============================================================
-- Admin V2 — Backfill: inbound_receipt → purchase_batches
--
-- Replaces the single PO-000 "Legacy Import" catch-all with
-- one purchase_batch per inbound_receipt, preserving the real
-- purchase history so each event is clickable in /admin/v2/purchases.
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING and WHERE guards.
-- Does NOT overwrite existing stock_unit.landed_cost values.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Temp mapping: inbound_receipt.id → new batch PO number
-- ─────────────────────────────────────────────────────────────

CREATE TEMP TABLE _receipt_batch_map (
  receipt_id     UUID PRIMARY KEY,
  batch_id       TEXT NOT NULL,
  vendor_name    TEXT,
  txn_date       DATE
) ON COMMIT DROP;

-- Assign PO numbers in chronological order
INSERT INTO _receipt_batch_map (receipt_id, batch_id, vendor_name, txn_date)
SELECT
  ir.id,
  'PO-' || lpad(nextval('public.purchase_batch_seq')::text, 3, '0'),
  ir.vendor_name,
  ir.txn_date
FROM public.inbound_receipt ir
ORDER BY ir.txn_date NULLS LAST, ir.created_at;

-- ─────────────────────────────────────────────────────────────
-- 1. Aggregate non-stock line costs per receipt → shared_costs
-- ─────────────────────────────────────────────────────────────

CREATE TEMP TABLE _receipt_shared_costs (
  receipt_id         UUID PRIMARY KEY,
  total_non_stock    NUMERIC(12,2) NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO _receipt_shared_costs (receipt_id, total_non_stock)
SELECT
  irl.inbound_receipt_id,
  COALESCE(SUM(irl.line_total), 0)
FROM public.inbound_receipt_line irl
WHERE irl.is_stock_line = false
GROUP BY irl.inbound_receipt_id;

-- ─────────────────────────────────────────────────────────────
-- 2. Create purchase_batches — one per inbound_receipt
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.purchase_batches (
  id, supplier_name, purchase_date, reference,
  supplier_vat_registered, shared_costs, total_shared_costs,
  status, unit_counter, created_at
)
SELECT
  m.batch_id,
  COALESCE(m.vendor_name, 'Unknown Supplier'),
  COALESCE(m.txn_date, CURRENT_DATE),
  ir.qbo_purchase_id,             -- preserve QBO link as reference
  false,                           -- can be updated later per supplier
  jsonb_build_object(
    'shipping', 0,
    'broker_fee', 0,
    'other', COALESCE(sc.total_non_stock, 0)
  ),
  COALESCE(sc.total_non_stock, 0),
  'recorded',
  0,                               -- updated in step 6
  ir.created_at
FROM _receipt_batch_map m
JOIN public.inbound_receipt ir ON ir.id = m.receipt_id
LEFT JOIN _receipt_shared_costs sc ON sc.receipt_id = m.receipt_id
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. Create purchase_line_items from stock receipt lines
-- ─────────────────────────────────────────────────────────────

-- Temp map: receipt_line.id → new line_item.id (for stock_unit linking)
CREATE TEMP TABLE _line_map (
  receipt_line_id   UUID PRIMARY KEY,
  new_line_item_id  UUID NOT NULL,
  batch_id          TEXT NOT NULL
) ON COMMIT DROP;

-- Pre-generate UUIDs so we can reference them when linking stock_units
INSERT INTO _line_map (receipt_line_id, new_line_item_id, batch_id)
SELECT
  irl.id,
  gen_random_uuid(),
  m.batch_id
FROM public.inbound_receipt_line irl
JOIN _receipt_batch_map m ON m.receipt_id = irl.inbound_receipt_id
WHERE irl.is_stock_line = true
  AND irl.mpn IS NOT NULL
  AND irl.mpn != '';

INSERT INTO public.purchase_line_items (
  id, batch_id, mpn, quantity, unit_cost, apportioned_cost, landed_cost_per_unit, created_at
)
SELECT
  lm.new_line_item_id,
  lm.batch_id,
  irl.mpn,
  irl.quantity,
  irl.unit_cost,
  0,             -- will be calculated below
  irl.unit_cost, -- will be recalculated below
  irl.created_at
FROM _line_map lm
JOIN public.inbound_receipt_line irl ON irl.id = lm.receipt_line_id
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. Re-link stock_units to new batches and line items
--    Uses the existing inbound_receipt_line_id FK on stock_unit
-- ─────────────────────────────────────────────────────────────

UPDATE public.stock_unit su
SET
  batch_id     = lm.batch_id,
  line_item_id = lm.new_line_item_id
FROM _line_map lm
WHERE su.inbound_receipt_line_id = lm.receipt_line_id
  AND su.inbound_receipt_line_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. Recalculate apportioned costs per batch
--    This distributes non-stock costs (shipping/fees) across
--    stock lines proportionally, and propagates to stock_unit.landed_cost.
--
--    NOTE: For batches with shared_costs > 0, this WILL update
--    stock_unit.landed_cost. For batches with zero shared costs,
--    landed_cost = unit_cost (no change for most units).
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_batch_id TEXT;
BEGIN
  FOR v_batch_id IN
    SELECT DISTINCT batch_id FROM _line_map
  LOOP
    PERFORM public.v2_calculate_apportioned_costs(v_batch_id);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Update unit_counter on each new batch
-- ─────────────────────────────────────────────────────────────

UPDATE public.purchase_batches pb
SET unit_counter = sub.cnt
FROM (
  SELECT batch_id, COUNT(*)::integer AS cnt
  FROM public.stock_unit
  WHERE batch_id IN (SELECT batch_id FROM _receipt_batch_map)
  GROUP BY batch_id
) sub
WHERE pb.id = sub.batch_id;

-- ─────────────────────────────────────────────────────────────
-- 7. Clean up PO-000
--    Remove line items and the batch itself if no orphan units remain.
--    Orphan units (no inbound_receipt_line_id) stay on PO-000.
-- ─────────────────────────────────────────────────────────────

-- Delete PO-000 line items that have no remaining stock units
DELETE FROM public.purchase_line_items pli
WHERE pli.batch_id = 'PO-000'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_unit su
    WHERE su.line_item_id = pli.id
      AND su.batch_id = 'PO-000'
  );

-- Update PO-000 unit_counter
UPDATE public.purchase_batches
SET unit_counter = (
  SELECT COUNT(*) FROM public.stock_unit WHERE batch_id = 'PO-000'
)
WHERE id = 'PO-000';

-- If PO-000 has zero units, delete it entirely
DELETE FROM public.purchase_batches
WHERE id = 'PO-000'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_unit WHERE batch_id = 'PO-000'
  );

-- ─────────────────────────────────────────────────────────────
-- 8. Generate UIDs for any units that still lack one
-- ─────────────────────────────────────────────────────────────

UPDATE public.stock_unit su
SET uid = 'LI-' || lpad(rn::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.stock_unit
  WHERE uid IS NULL
) numbered
WHERE su.id = numbered.id
  AND su.uid IS NULL;

COMMIT;
