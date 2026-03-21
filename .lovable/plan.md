

## Root Cause: UI Reads Wrong Response Fields — Loop Breaks After First Batch

### The Bug

The `qbo-process-pending` edge function returns this shape:
```json
{
  "success": true,
  "results": {
    "items": { "processed": 50, "errors": 0 },
    "purchases": { "processed": 14, "errors": 0, "stock_created": 42 }
  },
  "remaining": { "items": 317, "purchases": 559, ... },
  "has_more": true,
  "total_remaining": 900
}
```

But the UI (`QboSettingsPanel.tsx`) reads `data.items_committed`, `data.purchases_committed`, etc. — **fields that do not exist**. They are always `undefined`, so `committed` computes to `0`, and the loop on line 283 (`if (committed === 0) break`) exits immediately after the **first batch**.

This is why only 14 of 623 purchases were processed. The processor works correctly — the UI just stops calling it.

**Current database state confirms this:**
- 573 purchases still `pending`, only 14 `committed`
- 317 items still `pending`, only 50 `committed`
- Only 56 available stock units exist (from the one batch that ran)

### Fix

**File: `src/pages/admin/QboSettingsPanel.tsx`**

1. **Rebuild loop (lines 276-284):** Replace field reads with the actual response shape. Use `data.results` to sum processed counts and `data.has_more` / `data.total_remaining` for the continue condition.

2. **Standalone `processPending` function (lines 186-192):** Same fix — read from `data.results.items.processed` etc. instead of nonexistent `data.items_committed`.

3. **Loop break condition:** Use `data.has_more === false` or `data.total_remaining === 0` instead of checking committed counts.

### Technical Detail

```typescript
// BEFORE (broken):
const committed = (data.items_committed ?? 0) + (data.purchases_committed ?? 0) + ...;
if (committed === 0) break;

// AFTER (correct):
const r = data.results ?? {};
const committed = (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
  (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0);
setRebuildPhase(`Processed ${totalProcessed} records (${data.total_remaining ?? 0} remaining)…`);
if (!data.has_more) break;
```

### Files Modified

- `src/pages/admin/QboSettingsPanel.tsx` — fix response field mapping in both `processPending` and `rebuildFromQbo`

