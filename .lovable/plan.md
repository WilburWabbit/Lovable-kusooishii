

## Filter Non-Stock Purchases in QBO Sync

### Problem
The sync imports all QBO purchases, including non-stock expenses (e.g. utility bills, service fees) that have no `ItemBasedExpenseLineDetail` lines. These clutter the Intake page.

### Solution
Add a filter in `supabase/functions/qbo-sync-purchases/index.ts` after fetching purchases from QBO. Skip any purchase whose `Line` array contains zero `ItemBasedExpenseLineDetail` entries.

### Change (single file)

**`supabase/functions/qbo-sync-purchases/index.ts`** — after line 109 (`for (const purchase of purchases)`), add a check:

```typescript
const itemLines = purchase.Line?.filter(
  (l: any) => l.DetailType === "ItemBasedExpenseLineDetail"
) ?? [];

if (itemLines.length === 0) continue; // skip non-stock expenses
```

This goes right after `for (const purchase of purchases) {` and before the existing upsert logic. Purchases with only `AccountBasedExpenseLineDetail` lines (or no lines at all) will be skipped entirely — no receipt header or lines created.

Then redeploy the `qbo-sync-purchases` edge function.

### Scope
- One file changed, ~3 lines added
- Redeploy edge function

