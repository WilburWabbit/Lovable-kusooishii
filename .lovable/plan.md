

## Diagnosis: QBO Sales Sync — Schema Cache Stale + Stock Missing

### What's actually happening

The sync function **is mostly working** — logs show it processing 343 sales receipts and 12 refunds per run, successfully deduplicating eBay orders against QBO. But two issues cause stock divergence:

### Issue 1: PostgREST schema cache is stale

The columns `qbo_customer_id`, `qbo_sales_receipt_id`, `qbo_sync_status` **do exist** on `sales_order` (added by migration `20260319220000`). However, PostgREST hasn't reloaded its schema cache, so it rejects writes that include these columns with `PGRST204`.

The fallback logic (lines 487-496) silently **drops** the QBO tracking columns and retries — so orders get created but **without QBO IDs or sync status**. This means:
- No `qbo_sales_receipt_id` → re-runs can't detect these orders were already processed → potential duplicates
- No `qbo_sync_status` → retry/alert mechanisms don't work

**Fix**: Run a migration with `NOTIFY pgrst, 'reload schema'` to force PostgREST to pick up the columns that already exist.

### Issue 2: Missing stock units for sold SKUs

Logs show repeated warnings: `No available stock for SKU 10335-1.1`, `40702-1.1`, `40651-1.1`, `40700-1.1`, `77072-1.1`, `75349-1.2`, `10317-1.1`.

When the sync creates an order line but can't find an `available` stock unit, it sets `stock_unit_id = null` and doesn't close any stock. QBO has already decremented its `QtyOnHand` for these sales, but the app never closed the corresponding units — hence the discrepancy.

Root causes:
- Purchase receipts for these SKUs may not have been synced yet (stock units never created)
- Or stock was previously closed/written off incorrectly by the item reconciliation seeing the mismatch

**Fix**: After fixing Issue 1, re-run the full purchase sync first (to ensure all stock units exist), then re-run the sales sync (to close stock via FIFO). Finally run stock reconciliation to verify alignment.

### Plan

**Step 1 — Database migration** (one statement):
```sql
NOTIFY pgrst, 'reload schema';
```

**Step 2 — No code changes needed.** The edge function code already handles these columns correctly; it just needs PostgREST to recognise them.

**Step 3 — Operational steps** (user action after deploy):
1. Run "Sync Purchases" to ensure all stock units exist
2. Run "Sync Sales" to reprocess — this time QBO tracking columns will persist
3. Run "Reconcile Stock" to verify alignment

### Technical detail

The `allocate_stock_units` RPC function works correctly — it atomically selects and closes FIFO stock via `FOR UPDATE SKIP LOCKED`. The problem is upstream: if stock units don't exist for a SKU, there's nothing to allocate.

