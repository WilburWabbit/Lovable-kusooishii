

## Fix: BrickEconomy sync returning "No items found"

### Root Cause
The edge function assumes the API response has an `items` array at the top level (`setsData.items`), but the actual BrickEconomy API wraps everything in a `"data"` object with different field names:

- **Sets**: `response.data.sets` (not `response.items`)
- **Minifigs**: `response.data.minifigs` (not `response.items`)
- **Acquired date field**: API uses `aquired_date` (their typo), not `acquired_date`
- **Set number field in sets**: `set_number` (correct in current code)
- **Minifig number field**: `minifig_number` (correct in current code)
- **Portfolio counts**: `sets_count`, `sets_unique_count`, `minifigs_count`, `minifigs_unique_count` (not `total_count`/`unique_count`)

### Changes to `supabase/functions/brickeconomy-sync/index.ts`

1. **Unwrap `data` envelope** — after parsing JSON, access `setsData.data` and `minifigsData.data` instead of using the raw response directly.

2. **Fix array access** — use `.sets` for sets and `.minifigs` for minifigs instead of `.items`.

3. **Fix field mappings**:
   - `aquired_date` → map to `acquired_date` column (the API typo)
   - Portfolio snapshot: use `sets_count`/`sets_unique_count` for sets, `minifigs_count`/`minifigs_unique_count` for minifigs

4. **Fix snapshot counts** — use `data.sets_count` and `data.sets_unique_count` instead of `total_count`/`unique_count`.

### No database changes needed
The tables are correct. Only the edge function's response parsing needs fixing.

