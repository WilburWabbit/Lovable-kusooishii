

# Fix Build Errors and QBO Sync Timeout Issues

## Overview

There are two categories of issues: **build errors** preventing compilation, and **architectural timeout problems** in the QBO sync functions.

## Build Errors (6 issues)

### 1. auth-email-hook deno.json — npm import resolution failure
The `deno.json` maps `npm:@lovable.dev/webhooks-js` → `npm:@lovable.dev/webhooks-js@latest` but Deno can't resolve it in node_modules. Fix: remove the `imports` and `nodeModulesDir` keys — the `npm:` specifiers in `index.ts` already work natively in Deno edge runtime without remapping.

### 2. `productDataMap` missing from `PurchaseBatchDetail` type
`BatchDetail.tsx` (line 140) and `use-purchase-batches.ts` (line 226) reference `productDataMap` but `PurchaseBatchDetail` in `src/lib/types/admin.ts` doesn't declare it. Fix: add `productDataMap?: Map<string, any>` to the `PurchaseBatchDetail` interface.

### 3. Four `as Record<string, unknown>` cast errors
`CustomerList.tsx`, `OrderList.tsx`, `PayoutView.tsx`, and `ProductList.tsx` all cast typed interfaces to `Record<string, unknown>` in their `getValue` functions. TypeScript rejects this because the interfaces have no index signature. Fix: cast via `unknown` first — `(row as unknown as Record<string, unknown>)[key]` in each file.

## QBO Sync Timeout Issues

### Root cause: cascading `drainPendingQbo` calls
Every land-only function (`qbo-sync-purchases`, `qbo-sync-sales`, `qbo-sync-customers`, `qbo-sync-items`) calls `drainPendingQbo()` after landing data. This invokes `qbo-process-pending` up to 25 times with a 60-second timeout each — meaning a single sync button click can chain up to **25 minutes** of nested edge function calls. Combined with the UI's month-by-month loop for purchases/sales, each month triggers its own drain loop, causing cascading timeouts and function-to-function call storms.

### Fix: Remove auto-drain from land-only functions
The land-only functions should **only land data** and return immediately. Processing should be triggered separately via the existing "Process Pending" button in the UI, or by the rebuild flow which already loops `qbo-process-pending` explicitly.

**Files to change:**
- `supabase/functions/qbo-sync-purchases/index.ts` — remove `drainPendingQbo` function and its call
- `supabase/functions/qbo-sync-sales/index.ts` — same
- `supabase/functions/qbo-sync-customers/index.ts` — same  
- `supabase/functions/qbo-sync-items/index.ts` — same

### Additional: UI auto-process after landing
Update `QboSettingsPanel.tsx` so that after a full landing sync completes (purchases, sales, customers, or items), it automatically triggers the client-side `processPending()` drain loop — which already has proper progress tracking and timeout handling. This is safer because the client controls the loop and can show progress/cancel.

### `ensure_product_exists` function missing
Edge function logs show repeated warnings: `Could not find the function public.ensure_product_exists(...)`. This database function is called by `qbo-process-pending` but doesn't exist in the schema. The fallback path works but is slower. Fix: create this function via migration.

## Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/auth-email-hook/deno.json` | Remove `imports` and `nodeModulesDir` keys |
| `src/lib/types/admin.ts` | Add `productDataMap` to `PurchaseBatchDetail` |
| `src/components/admin-v2/CustomerList.tsx` | Fix `as unknown as Record<string, unknown>` cast |
| `src/components/admin-v2/OrderList.tsx` | Same cast fix |
| `src/components/admin-v2/PayoutView.tsx` | Same cast fix |
| `src/components/admin-v2/ProductList.tsx` | Same cast fix |
| `supabase/functions/qbo-sync-purchases/index.ts` | Remove `drainPendingQbo` |
| `supabase/functions/qbo-sync-sales/index.ts` | Remove `drainPendingQbo` |
| `supabase/functions/qbo-sync-customers/index.ts` | Remove `drainPendingQbo` |
| `supabase/functions/qbo-sync-items/index.ts` | Remove `drainPendingQbo` |
| `src/pages/admin/QboSettingsPanel.tsx` | Auto-trigger processPending after landing completes |
| New migration | Create `ensure_product_exists` database function |

