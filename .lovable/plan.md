

## Fix: `qbo-sync-purchases` Still Timing Out (All 36 Months in One Call)

### Problem
The monthly batching helped structure the work, but the function still loops through all ~36 months in a single invocation. Each month requires a QBO API call + individual landing upserts even for already-committed months. The function gets killed at ~150s (around month 2023-06).

The "fast-path skip" only kicks in **after** landing all purchases for that month — it doesn't avoid the QBO API call or the landing upserts.

### Solution
**Process only ONE month per invocation.** The frontend loops through months client-side, calling the edge function once per month. This guarantees each call handles 3-30 purchases and completes in seconds.

### Changes

**`supabase/functions/qbo-sync-purchases/index.ts`**
- Remove the `for (const { start, end, label } of monthRanges)` loop — the function processes exactly one month range per call
- Keep `generateMonthRanges()` but only use it for the single-month case
- If no `month` param is provided, default to the **current month** (not all months)
- Return results for that single month plus a `month` field in the response

**`src/pages/admin/QboSettingsPanel.tsx`**
- Update `syncPurchases` to generate the month list client-side (current month → April 2023)
- Loop through months sequentially, calling `invokeWithAuth("qbo-sync-purchases", { month })` for each
- Show a progress indicator: "Syncing 2025-06... (month 8 of 36)"
- Accumulate totals across all months for the final toast
- Add a "Stop" button to cancel mid-sync
- On re-run, already-committed months will fast-path skip in ~1-2 seconds each

```text
Client loop:
  for each month from current → Apr 2023:
    response = invokeWithAuth("qbo-sync-purchases", { month: "YYYY-MM" })
    accumulate totals
    update progress UI
  show final toast with accumulated totals
```

### Scope
| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-purchases/index.ts` | Remove multi-month loop; default to current month when no param |
| `src/pages/admin/QboSettingsPanel.tsx` | Client-side month loop with progress UI |

No database migration needed.

