

# Fix: Reconcile Sales — Wrong Column Name

## Root Cause

The `reconcile-sales` action in `admin-data/index.ts` queries `sales_order` with a non-existent column `total_amount` (line 2154). The `sales_order` table uses `gross_total` instead.

PostgREST returns a 400 error for this query, so `appRecords` is `null`. The `appMap` is built from an empty array, and **every** QBO SalesReceipt is incorrectly flagged as "In QBO but missing from app" — even though all 331 records exist in the app with correct `qbo_sales_receipt_id` values.

The sales orders are NOT actually missing. This is purely a reporting bug in the reconciliation tool.

## Fix

**File**: `supabase/functions/admin-data/index.ts`

Line 2154 — change:
```
.select("id, qbo_sales_receipt_id, total_amount, origin_channel, order_number")
```
to:
```
.select("id, qbo_sales_receipt_id, gross_total, origin_channel, order_number")
```

Line 2165 — change:
```
const appTotal = Math.round(Number(app.total_amount ?? 0) * 100) / 100;
```
to:
```
const appTotal = Math.round(Number(app.gross_total ?? 0) * 100) / 100;
```

No other files need changes. The purchases reconcile (`inbound_receipt.total_amount`) is correct — that table does have `total_amount`.

