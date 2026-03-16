-- Add detail fields to product table for the Details tab
ALTER TABLE product ADD COLUMN IF NOT EXISTS minifigs_count integer;
ALTER TABLE product ADD COLUMN IF NOT EXISTS retail_price numeric(10,2);
ALTER TABLE product ADD COLUMN IF NOT EXISTS version_descriptor text;
ALTER TABLE product ADD COLUMN IF NOT EXISTS brickeconomy_id text;
ALTER TABLE product ADD COLUMN IF NOT EXISTS bricklink_item_no text;
ALTER TABLE product ADD COLUMN IF NOT EXISTS brickowl_boid text;
ALTER TABLE product ADD COLUMN IF NOT EXISTS rebrickable_id text;
ALTER TABLE product ADD COLUMN IF NOT EXISTS released_date date;
ALTER TABLE product ADD COLUMN IF NOT EXISTS retired_date date;
ALTER TABLE product ADD COLUMN IF NOT EXISTS field_overrides jsonb DEFAULT '{}'::jsonb;

-- Backfill from lego_catalog
UPDATE product p
SET
  version_descriptor = COALESCE(p.version_descriptor, lc.version_descriptor),
  brickeconomy_id    = COALESCE(p.brickeconomy_id, lc.brickeconomy_id),
  bricklink_item_no  = COALESCE(p.bricklink_item_no, lc.bricklink_item_no),
  brickowl_boid      = COALESCE(p.brickowl_boid, lc.brickowl_boid),
  rebrickable_id     = COALESCE(p.rebrickable_id, lc.rebrickable_id)
FROM lego_catalog lc
WHERE p.lego_catalog_id = lc.id;

-- Backfill from brickeconomy_collection (most recent sync per item_number)
UPDATE product p
SET
  minifigs_count = COALESCE(p.minifigs_count, be.minifigs_count),
  retail_price   = COALESCE(p.retail_price, be.retail_price),
  released_date  = COALESCE(p.released_date, be.released_date::date),
  retired_date   = COALESCE(p.retired_date, be.retired_date::date)
FROM (
  SELECT DISTINCT ON (item_number)
    item_number, minifigs_count, retail_price, released_date, retired_date
  FROM brickeconomy_collection
  ORDER BY item_number, synced_at DESC
) be
WHERE p.mpn = be.item_number OR p.mpn LIKE be.item_number || '-%';
