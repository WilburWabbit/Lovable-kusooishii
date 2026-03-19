

## Fix: QBO Sync Stock Inconsistencies

### Problems Found

After reading all three sync functions thoroughly, there are **four distinct bugs** causing the app to diverge from QBO:

**Bug 1 — Sales sync never reprocesses updated receipts**
In `qbo-sync-sales`, when a receipt is re-landed (QBO updated it), `landSalesReceipt` updates the `raw_payload` but keeps the `committed` status. Phase 2 only fetches `status = 'pending'` rows — so updated receipts are silently ignored. If a sale's quantity or line items change in QBO, the app never reflects that.

**Bug 2 — Bulk sales sync skips existing orders without updating**
`processSalesReceipt` (line 329) does `if (existing) return { created: false }` — a hard skip. The webhook handler correctly does delete-and-recreate for same-channel updates (lines 786-793), but the bulk sync doesn't. This means re-running sync never fixes stale order data.

**Bug 3 — Purchase webhook skips already-processed receipts**
`handlePurchase` (line 516): `if (receipt.status === "processed") return "already processed — skipped"`. If a purchase is edited in QBO (quantity changed, line added/removed), stock units are never adjusted. The receipt stays frozen at the original processing state.

**Bug 4 — Item sync doesn't deactivate removed/inactive QBO items**
`qbo-sync-items` upserts all current QBO items but never deactivates SKUs whose `qbo_item_id` no longer appears in the QBO response. Deleted or deactivated QBO items leave stale SKUs with phantom stock counts.

### Technical Changes

**File 1: `supabase/functions/qbo-sync-sales/index.ts`**

- **`landSalesReceipt`**: When updating an existing row whose status is `committed`, check if `raw_payload` actually changed (compare serialised JSON or use a checksum). If changed, reset status to `pending` so Phase 2 reprocesses it.
- **`landRefundReceipt`**: Same pattern — reset to `pending` if payload changed.
- **`processSalesReceipt`**: When an existing QBO-originated order is found (same `origin_channel` + `origin_reference`), delete-and-recreate it (reopen linked stock units first, then delete lines and order, then proceed with fresh insert). Mirror the webhook handler's pattern at lines 786-793. Do NOT do this for cross-channel dedup matches (eBay/web) — those should still just enrich.

**File 2: `supabase/functions/qbo-webhook/index.ts`**

- **`handlePurchase`**: Remove the `if (receipt.status === "processed") return "already processed — skipped"` guard. Instead, for processed receipts: reopen stock units linked to old receipt lines, delete old lines, re-create from updated QBO data, and re-run the auto-process flow. This handles retroactive purchase adjustments.

**File 3: `supabase/functions/qbo-sync-items/index.ts`**

- After the main upsert loop, add a cleanup pass:
  - Collect all `qbo_item_id` values seen in this sync run.
  - Query all SKUs that have a non-null `qbo_item_id` but whose ID is NOT in the seen set.
  - Mark those SKUs as `active_flag = false`.
  - For each deactivated SKU, also set any `available` stock units to `written_off` (with audit trail).
  - This ensures deleted/deactivated QBO items don't leave phantom inventory.

### What This Does NOT Change

- **Refunds**: Refunds correctly record negative order lines without reopening stock. No change needed — the user confirmed refunds should not assume stock is returned.
- **QtyOnHand reconciliation**: The existing reconcile logic remains as a safety net after the above fixes drain the backlog of unprocessed updates.

### Estimated Scope

- 3 edge function files modified
- No database migrations needed
- No UI changes needed

