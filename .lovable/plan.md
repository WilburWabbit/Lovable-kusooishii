

## Fix: `qbo-sync-purchases` Timing Out

### Problem
The function **is** being called (logs confirm it boots, lands 623 purchases, pre-fetches 275 items) but then gets killed by the edge function timeout (~60s) during Phase 3 — processing 623 purchases sequentially with multiple DB queries per purchase (upsert receipt, delete+insert lines, resolve tax codes, auto-process with product/SKU lookups, create stock units). The client receives no response, which looks like "not called."

### Fix
Add **incremental sync** so the function only processes new/changed purchases instead of re-processing all 623 every time.

**Changes to `supabase/functions/qbo-sync-purchases/index.ts`:**

1. **Track last sync timestamp** — before querying QBO, read the most recent `received_at` from `landing_raw_qbo_purchase`. Use it to filter the QBO query:
   ```
   SELECT * FROM Purchase WHERE MetaData.LastUpdatedTime > '{lastSync}'
   ```
   This reduces the QBO result set from 623 to only new/modified purchases.

2. **Skip already-committed landings early** — in Phase 3, when `alreadyLanded === true` and receipt status is `"processed"`, skip the full re-processing loop (currently it still runs backfill on every committed record).

3. **Add a `full_sync` parameter** — allow the UI to pass `{ full_sync: true }` to force a full re-sync when needed, otherwise default to incremental.

4. **Update the UI** (`QboSettingsPanel.tsx`) — update `syncPurchases` to pass no body by default (incremental). Optionally add a "Full Sync" button later.

### Expected Impact
- Typical sync: 0-10 new purchases instead of 623 → completes in seconds
- Full sync still available when explicitly requested
- No database migration needed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-purchases/index.ts` | Add incremental sync via QBO date filter + `full_sync` param |
| `src/pages/admin/QboSettingsPanel.tsx` | No change needed (works as-is; incremental is the default) |

