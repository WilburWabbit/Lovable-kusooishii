

## Filter Out Account-Only Purchases

### Problem
Every QBO Purchase is upserted into `inbound_receipt`, even those with zero `ItemBasedExpenseLineDetail` lines (e.g. pure expense transactions like rent, utilities). These create permanent "pending" receipts that clutter the Intake page and can never be processed.

### Fix

In `supabase/functions/qbo-sync-purchases/index.ts`, add a check **before the upsert** to skip purchases that have no item-based lines:

```text
For each purchase:
  Check: does it have any ItemBasedExpenseLineDetail lines?
    No  → skip entirely (don't upsert, increment a "skipped_no_items" counter)
    Yes → proceed with upsert + line rebuild + auto-process
```

### Changes

**1. `supabase/functions/qbo-sync-purchases/index.ts`** — Before the upsert block (~line 283), check if the purchase has at least one `ItemBasedExpenseLineDetail` line. If not, increment a counter and `continue`. Also add `skipped_no_items` to the response payload.

**2. Clean up existing account-only receipts** — Optionally, after the main loop, delete any `inbound_receipt` records with status `pending` that have zero `is_stock_line = true` lines. This cleans up the mess from previous syncs.

### Response payload addition
- `skipped_no_items`: count of purchases skipped because they had no item-based lines

