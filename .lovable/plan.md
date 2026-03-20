

## Architectural Refactor: Strict Land → Process → Commit Separation

### The Problem

The current codebase violates its own staging architecture. Every sync function and the webhook handler performs **landing AND processing in the same call**, with processing logic duplicated across 4 files (~4,000 lines total):

- `qbo-sync-purchases` (937 lines) — lands purchases, then immediately processes into receipts → receipt lines → stock units
- `qbo-sync-sales` (1094 lines) — lands sales/refunds, then immediately processes into sales orders → order lines → stock allocation
- `qbo-webhook` (1628 lines) — fetches single entities, then does the SAME processing inline (800+ lines of duplicated logic)
- `admin-data` (1794 lines) — has its own reconciliation and rebuild logic

This duplication means every bug fix must be applied in 2-3 places, and subtle differences between copies cause data drift. The 42164-1 issue (9 purchased, 3 sold, 0 available) is a symptom: the sync stopped partway through, and the cleanup pass deleted pending receipts from months it hadn't reached yet.

### The Solution

Split into three clean layers, each in its own edge function:

```text
┌─────────────────────────────────────────────────┐
│  LAND (thin)                                    │
│  qbo-sync-purchases  → landing_raw_qbo_purchase │
│  qbo-sync-sales      → landing_raw_qbo_sales_*  │
│  qbo-sync-items      → landing_raw_qbo_item     │
│  qbo-sync-customers  → landing_raw_qbo_customer │
│  qbo-webhook         → lands to same tables     │
│                                                 │
│  No canonical writes. Just QBO API → staging.   │
├─────────────────────────────────────────────────┤
│  PROCESS (single function, called separately)   │
│  qbo-process-pending                            │
│                                                 │
│  Reads ALL pending landing records.             │
│  Processes in dependency order:                 │
│    1. Items → SKUs                              │
│    2. Purchases → Receipts → Stock Units        │
│    3. Sales → Sales Orders → Stock Allocation   │
│    4. Refunds → Refund Orders                   │
│    5. Customers → Customer records + backlinks  │
│  Marks each landing as committed on success.    │
│                                                 │
│  ONE copy of processing logic. Period.          │
├─────────────────────────────────────────────────┤
│  RECONCILE (existing, cleaned up)               │
│  admin-data: reconcile-stock                    │
│  admin-data: rebuild-from-qbo                   │
│                                                 │
│  Rebuild = delete canonical data + reset all    │
│  landings to pending. Then call process-pending. │
└─────────────────────────────────────────────────┘
```

### File Changes

#### 1. Slim down `qbo-sync-purchases` (~200 lines, was 937)
- Remove `autoProcessReceipt`, `backfillProcessedReceipt`, all canonical table writes
- Keep: QBO API query, `landPurchase()`, `landQboItem()` 
- Remove the global cleanup pass (lines 878-908) entirely
- Return count of landed/skipped records only

#### 2. Slim down `qbo-sync-sales` (~250 lines, was 1094)
- Remove all canonical processing (sales order creation, stock allocation, refund handling)
- Keep: QBO API query, `landSalesReceipt()`, `landRefundReceipt()`, `landQboItem()`
- Return count of landed/skipped records only

#### 3. Slim down `qbo-webhook` (~300 lines, was 1628)
- Remove all 5 handler functions that write to canonical tables
- Replace with: fetch entity from QBO → upsert into appropriate landing table with status `pending`
- Keep: signature verification, token refresh, entity dispatch to landing tables
- The webhook becomes a thin relay: QBO notification → landing table row

#### 4. New `qbo-process-pending` edge function (~800 lines)
The single source of truth for all processing logic. Accepts optional filters (`entity_type`, `batch_size`, `external_id`).

Processing sequence per invocation:
1. **Items** — Query `landing_raw_qbo_item` where status = `pending`. For each: upsert SKU, resolve product, reconcile QtyOnHand. Mark committed.
2. **Purchases** — Query `landing_raw_qbo_purchase` where status = `pending`. For each: upsert receipt, create receipt lines, create stock units (with shortfall guard), handle sold-unit reallocation for updates. Mark committed.
3. **Sales Receipts** — Query `landing_raw_qbo_sales_receipt` where status = `pending`. For each: cross-channel dedup, create/update sales order + lines, allocate stock (FIFO). Mark committed.
4. **Refund Receipts** — Query `landing_raw_qbo_refund_receipt` where status = `pending`. For each: create refund order with negative totals. Mark committed.
5. **Customers** — Query `landing_raw_qbo_customer` where status = `pending`. For each: upsert customer record, backlink orders. Mark committed.

Chunked processing with configurable batch size (default 50). Returns counts per entity type and any errors.

#### 5. Update `admin-data` rebuild-from-qbo
Simplify to:
1. Delete all canonical data (stock units, receipt lines, receipts, QBO sales orders/lines)
2. Reset ALL landing tables to `pending`
3. Return counts — caller then triggers `qbo-process-pending`

#### 6. Update `QboSettingsPanel.tsx`
- Sync buttons now only land data (fast, no timeouts)
- Add "Process Pending" button that calls `qbo-process-pending`
- Rebuild sequence: Reset → Land (all syncs) → Process Pending → Reconcile
- Show pending counts per entity type for visibility

#### 7. Slim down `qbo-sync-items` and `qbo-sync-customers`
- These already land to staging tables — remove any canonical processing
- `qbo-sync-items`: remove SKU upsert/reconcile logic, just land items
- `qbo-sync-customers`: remove customer upsert logic, just land customers

### What This Fixes

- **42164-1 problem**: Purchases land fast (no processing timeouts). Processing runs separately and can be retried without re-fetching from QBO.
- **Duplication**: ONE copy of processing logic instead of 3-4.
- **Cleanup pass bug**: Eliminated entirely — no global deletion of pending receipts.
- **Webhook parity**: Webhook just lands data; same processor handles it.
- **Rebuild reliability**: Reset + process is deterministic and idempotent.

### What Stays The Same

- Landing table schema (no migrations needed)
- Canonical table schema (no migrations needed)
- All RLS policies
- The fundamental data model (SKU = MPN.Grade, stock units, receipts, sales orders)
- BrickEconomy enrichment and AI copy generation (moved to processor, triggered on new items)

### Implementation Order

1. Create `qbo-process-pending` with all processing logic extracted and consolidated
2. Slim `qbo-sync-purchases` to land-only
3. Slim `qbo-sync-sales` to land-only  
4. Slim `qbo-webhook` to land-only
5. Slim `qbo-sync-items` to land-only
6. Slim `qbo-sync-customers` to land-only
7. Update `admin-data` rebuild
8. Update `QboSettingsPanel.tsx` UI

