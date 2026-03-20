## QBO Stock Consistency Fixes — Implementation Complete

### Bugs Fixed (8 total)

1. **`qbo-sync-purchases` landing change detection** — `landPurchase()` now compares `raw_payload` JSON and resets `committed` → `pending` when payload changes
2. **`qbo-sync-purchases` processed receipt reprocessing** — Delete-and-recreate with sold-unit SKU reallocation and landed cost propagation
3. **`qbo-webhook` handlePurchase sold-unit reallocation** — Matches sold units to new lines by MPN, updates `sku_id`/`landed_cost`/`carrying_value`
4. **`qbo-webhook` handlePurchase landed cost propagation** — Covered by #3
5. **`qbo-webhook` handlePurchase safe deletion** — Writes off available units, nullifies FK on sold units instead of deleting them
6. **`reconcileQtyOnHand` auto-backfill** — Both webhook and sync-items copies now auto-create balancing stock units when QBO > app
7. **`admin-data` reconcile-stock auto-fix** — FIFO write-off (app > QBO) and auto-backfill (QBO > app) with full audit trails
8. **`admin-data` rebuild-from-qbo action** — Nuclear reset with full replay capability

### Files Modified

1. `supabase/functions/qbo-sync-purchases/index.ts` — Bugs 1, 2
2. `supabase/functions/qbo-webhook/index.ts` — Bugs 3, 4, 5, 6
3. `supabase/functions/qbo-sync-items/index.ts` — Bug 6
4. `supabase/functions/admin-data/index.ts` — Bugs 7, 8
5. `src/pages/admin/QboSettingsPanel.tsx` — Rebuild from QBO button with confirmation dialog

### Next Steps

1. Run **Sync Items** — will auto-backfill where QBO qty > app
2. Run **Sync Purchases** — will reprocess changed purchases
3. Run **Sync Sales** — will reprocess changed sales
4. Run **Reconcile Stock** — will auto-fix remaining discrepancies
5. Or use **Rebuild from QBO** for a full deterministic replay
