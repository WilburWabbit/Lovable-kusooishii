

## Auto-Process QBO Purchases During Sync

### Current Flow
1. `qbo-sync-purchases` syncs purchases into `inbound_receipt` + `inbound_receipt_line` (status: pending)
2. User manually opens each receipt in Intake page and clicks "Process"
3. `process-receipt` creates SKUs and stock units

### New Flow
After syncing each purchase's lines, `qbo-sync-purchases` will automatically run the processing logic inline — creating SKUs and stock units, apportioning overhead, and marking the receipt as processed. No separate HTTP call to `process-receipt` needed.

**Exception handling**: If any stock line is missing an MPN (SKU field was empty/unparseable) or the MPN doesn't exist in `catalog_product`, the receipt stays `pending` for manual review on the Intake page.

### Changes

**1. `qbo-sync-purchases` edge function** — After inserting receipt lines, inline the processing logic:
- Check if receipt is new (status = pending) and all stock lines have `mpn` + `condition_grade`
- Calculate overhead apportionment (same pro-rata logic as `process-receipt`)
- Look up `catalog_product` by MPN, find/create SKU, create `stock_unit` records
- Mark receipt as `processed`
- If any MPN is missing from catalog, leave receipt as `pending` and record skipped lines
- Skip processing entirely for already-processed receipts (re-syncs)

**2. Response payload** — Extend the sync response to report:
- `auto_processed`: count of receipts auto-processed
- `left_pending`: count left for manual review (with reasons)
- `skipped_existing`: count of already-processed receipts untouched

**3. Intake page** — No structural changes needed. Receipts that were auto-processed will show as "processed". Only exception cases appear as "pending" for manual intervention.

**4. `process-receipt` edge function** — Keep as-is for manual processing of exception cases from the Intake page.

### Technical Detail

```text
Sync flow per purchase:
  Upsert receipt → Delete old lines → Insert new lines
                                           ↓
                              Check: is status "pending"?
                              Check: all stock lines have MPN + grade?
                                    ↓ yes              ↓ no
                          Auto-process:           Leave pending
                          - Apportion overhead    (manual review)
                          - Create SKUs
                          - Create stock_units
                          - Status → "processed"
```

