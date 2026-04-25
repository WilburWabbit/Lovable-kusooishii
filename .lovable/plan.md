## Problem

`brickeconomy_collection` and `brickeconomy_price_history` are storing `item_number` in two different shapes for the same physical set:

- `31172`     (bare, missing version suffix)
- `31172-1`   (canonical, matches `lego_catalog.mpn`)

This violates the core design rule: **MPN must always include the version suffix** (`75367-1`, `31172-1`, etc.). Specifically for set `31172-1` (Record Player with Flowers) we currently have:

- 2 rows in `brickeconomy_collection` (one bare, one suffixed)
- 3 rows in `brickeconomy_price_history`, all under the bare `31172`
- 1 (correct) row in `lego_catalog` under `31172-1`

Joins from `lego_catalog.mpn → brickeconomy_collection.item_number` silently miss the bare row, so pricing lookups can return wrong/empty data.

## Scope of the data issue

Before fixing, I'll quantify:

```sql
-- Find every item_number missing the "-N" version suffix
SELECT item_number, count(*)
FROM brickeconomy_collection
WHERE item_number !~ '-\d+$'
GROUP BY item_number;

-- Same for price history
SELECT item_number, count(*)
FROM brickeconomy_price_history
WHERE item_number !~ '-\d+$'
GROUP BY item_number;
```

## Fix — three parts

### 1. Backfill / normalise existing rows

For each bare `item_number` (e.g. `31172`), if a corresponding `<mpn>-1` exists in `lego_catalog`, rewrite the bare row to use the suffixed form. Then deduplicate (keep the most recent `synced_at`, merge `acquired_date`/`paid_price`/`condition` where present).

This will be done via insert-tool SQL (UPDATE + DELETE), not migrations.

### 2. Add a uniqueness constraint

Migration: add a unique index on `brickeconomy_collection (item_number, item_type)` so the sync can use `ON CONFLICT` and stop creating duplicates. (Will only be added after step 1 cleans existing dupes.)

### 3. Patch the BrickEconomy sync

Inspect `supabase/functions/brickeconomy-sync/index.ts` and the BrickEconomy fetch path to ensure every write normalises the item number to include the version suffix (default `-1` when BrickEconomy returns the bare set number, matching how `lego_catalog` stores it). Switch inserts to `upsert` keyed on the new unique index.

## Files / tools touched

- `supabase/functions/brickeconomy-sync/index.ts` — normalisation + upsert
- New migration — unique index on `brickeconomy_collection` and `brickeconomy_price_history`
- Data fix via insert tool (UPDATE/DELETE) — no migration needed for data

## Out of scope

- Changing the `lego_catalog.mpn` format (already correct)
- BrickEconomy API rate-limit work (separate concern; see `mem://integrations/brickeconomy`)
