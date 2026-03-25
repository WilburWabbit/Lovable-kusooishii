

# Why eBay and QBO Webhooks Are Not Working

## Root Causes Identified

### 1. Missing Database Function: `allocate_stock_units`
The migration `20260319200000_qbo_integration_fixes.sql` was never applied. The `allocate_stock_units` PL/pgSQL function does not exist in the database. This is why **250 QBO sales receipts are stuck in `error` status** with the message: *"Could not find the function public.allocate_stock_units(p_quantity, p_sku_id) in the schema cache"*.

### 2. QBO Webhook Still Calls `drainPendingQbo` Inline
The `qbo-webhook/index.ts` function (lines 80-115, called at line 370) still contains the `drainPendingQbo` loop that was supposed to be removed. This loop calls `qbo-process-pending` up to 25 times with 60-second timeouts, causing the webhook to exceed its execution time limit. Intuit requires a fast acknowledgment; the webhook likely times out, and Intuit may have disabled delivery.

### 3. eBay Notifications Stopped Arriving (March 12)
The last eBay notification was received on **March 12** (13 days ago). Zero logs for the `ebay-notifications` function means eBay is not calling the endpoint at all. The subscription/destination binding is likely stale or pointing to an incorrect URL.

### 4. No Recent Logs for Any Webhook Function
`ebay-notifications`, `qbo-webhook`, `ebay-process-order`, and `qbo-process-pending` all show zero logs, confirming neither external service is reaching these endpoints.

---

## Fix Plan

### Step 1: Apply the Missing Migration
Execute the `allocate_stock_units` function creation SQL to unblock the 250 stuck sales receipts. This is a standalone `CREATE OR REPLACE FUNCTION` statement.

### Step 2: Remove `drainPendingQbo` from QBO Webhook
Remove the inline processing loop (lines 80-115 and the call at lines 368-379) from `qbo-webhook/index.ts`. The webhook should only land data and return immediately. Processing is handled by the UI-driven client loop per the established architecture.

### Step 3: Redeploy Both Webhook Functions
Deploy `qbo-webhook` and `ebay-notifications` to ensure the latest code is live.

### Step 4: Re-register eBay Notification Subscriptions
Trigger the `ebay-sync` function with `action: "setup_notifications"` to recreate the destination and subscription bindings, fixing the stale endpoint.

### Step 5: Retry Errored QBO Sales Receipts
Reset the 250 errored `landing_raw_qbo_sales_receipt` rows back to `pending` status so they can be reprocessed now that the missing function exists.

---

## Technical Details

| File | Change |
|---|---|
| New migration SQL | `CREATE OR REPLACE FUNCTION allocate_stock_units(...)` |
| `supabase/functions/qbo-webhook/index.ts` | Remove `drainPendingQbo` function and its call block |
| Deploy | `qbo-webhook`, `ebay-notifications` |
| Data fix | `UPDATE landing_raw_qbo_sales_receipt SET status='pending', processed_at=NULL WHERE status='error'` |
| eBay setup | Invoke `ebay-sync` with `action: "setup_notifications"` |

