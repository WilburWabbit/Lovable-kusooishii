

# Add "Retry Failed QBO Push" Button

## What it does

Adds a button to the QBO tile on `/admin/data-sync` that resets any orders with `qbo_sync_status` = `failed` or `needs_manual_review` back to `pending`, then invokes the existing `qbo-retry-sync` edge function to process them — identical pattern to "Process Pending" but for outbound pushes.

## Changes

### 1. `src/components/admin-v2/QboSettingsCard.tsx`

**Add state** (near line 51):
- `retryingPush` boolean

**Add action** (near line 253, after `processPending`):
- `retryFailedPush` function that:
  1. Calls `invokeWithAuth('admin-data', { action: 'retry-failed-qbo-push' })` to reset `failed` / `needs_manual_review` orders to `pending`
  2. Then calls `invokeWithAuth('qbo-retry-sync')` to process them
  3. Toasts with count of orders reset + processed

**Add button** in the "Process & Reconcile" section (line 551, after "Process Pending"):
```
<Btn onClick={retryFailedPush} busy={retryingPush}>Retry Failed Push</Btn>
```

Update `anyBusy` to include `retryingPush`.

### 2. `supabase/functions/admin-data/index.ts`

Add a new action `retry-failed-qbo-push` that:
1. Updates `sales_order` rows where `qbo_sync_status IN ('failed', 'needs_manual_review')` → set `qbo_sync_status = 'pending'`, reset `qbo_retry_count = 0`
2. Returns `{ reset: <count> }`

This keeps the pattern consistent: `admin-data` handles the DB mutation, and the existing `qbo-retry-sync` function handles the actual QBO API calls.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/admin-data/index.ts` | Add `retry-failed-qbo-push` action |
| `src/components/admin-v2/QboSettingsCard.tsx` | Add retry button + handler |

