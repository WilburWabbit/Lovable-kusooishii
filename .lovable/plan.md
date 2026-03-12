

## Plan: Batch QBO Purchase Sync by Month (Current → April 2023)

### Problem
The current incremental sync still tries to fetch up to 1000 purchases in a single QBO API call, which can timeout during Phase 3 processing. The full_sync path is even worse.

### Solution
Replace the single QBO query with a month-by-month loop, starting from the current month and walking backwards to April 2023. Each iteration queries one calendar month of purchases, processes them fully, then moves to the previous month. The function returns after completing all months (or can be called with a specific `month` parameter to sync just one month).

### Changes

**`supabase/functions/qbo-sync-purchases/index.ts`** (lines ~440-475)

Replace the incremental/full date filter logic and single QBO query with:

1. **Month generation**: Build an array of `{start, end}` date ranges from current month back to April 2023, e.g. `[{2026-03-01, 2026-03-31}, {2026-02-01, 2026-02-28}, ... {2023-04-01, 2023-04-30}]`

2. **Optional `month` parameter**: Accept `{ month: "2025-06" }` from the request body to sync only a single month. Default: sync all months.

3. **Loop per month**: For each month, query QBO with:
   ```
   SELECT * FROM Purchase WHERE TxnDate >= '2025-06-01' AND TxnDate <= '2025-06-30' MAXRESULTS 1000
   ```
   Then run the existing Phase 1/2/3 logic for that batch.

4. **Early exit for already-synced months**: If all purchases in a month are `alreadyLanded` and none are new, skip to next month (fast path for historical data).

5. **Accumulate totals** across all months for the final response.

**`src/pages/admin/QboSettingsPanel.tsx`**

No UI change needed — the default call (no body) will process all months. The existing toast handler already displays the response counters.

### Key Details
- Each month typically has 10-30 purchases → well within the 60s timeout
- TxnDate filter (not MetaData.LastUpdatedTime) ensures no records are missed
- The `alreadyLanded` skip logic means re-running is cheap — committed months complete in milliseconds
- Single `month` param available for targeted re-syncs if needed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-purchases/index.ts` | Replace single query with month-by-month loop from now to Apr 2023 |

