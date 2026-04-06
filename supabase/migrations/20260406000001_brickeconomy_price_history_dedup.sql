-- =============================================================
-- Deduplicate brickeconomy_price_history to one row per item
-- per source per calendar day.
-- =============================================================
-- PostgREST's onConflict cannot target expression indexes, so
-- dedup is enforced here at the DB level while the application
-- code (brickeconomy-sync / fetch-product-data) handles the
-- actual upsert logic:
--   bulk_sync  → delete today's rows then re-insert
--   individual → check existence then update-or-insert
-- =============================================================

-- Remove any duplicate rows before adding the constraint.
-- Keep the latest recorded_at within each (item_type, item_number, source, day).
DELETE FROM public.brickeconomy_price_history
WHERE id NOT IN (
  SELECT DISTINCT ON (item_type, item_number, source, recorded_at::date) id
  FROM public.brickeconomy_price_history
  ORDER BY item_type, item_number, source, recorded_at::date, recorded_at DESC
);

-- Unique expression index: one row per (item_type, item_number, source, calendar day).
CREATE UNIQUE INDEX IF NOT EXISTS brickeconomy_price_history_daily_idx
  ON public.brickeconomy_price_history (item_type, item_number, source, (recorded_at::date));
