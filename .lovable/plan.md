
Execution review summary (current state)

1) QBO Sync Purchases
- Healthy.
- Evidence: `inbound_receipt` = 86 `processed`, 0 pending; `landing_raw_qbo_purchase` = 86 committed / 537 skipped / 0 error.
- Stock unit linkage and tax backfill also look healthy (no pending receipts with stock lines, no unlinked stock units).

2) QBO Sync Customers
- Healthy.
- Evidence: `customer` = 311 rows with QBO IDs; QBO/QBO-refund orders all linked to customers.

3) QBO Sync Items
- Failing partially.
- Evidence: `landing_raw_qbo_item` = 176 committed / 191 error.
- Error is consistent: `Could not find the 'qbo_parent_item_id' column of 'sku' in the schema cache`.
- Root cause confirmed: `public.sku` does NOT currently have `qbo_parent_item_id` in database (the code references it in both `qbo-sync-items` and `qbo-webhook`).

4) QBO Sync Orders (sales/refunds)
- Failing operationally due timeout, not auth/schema.
- Evidence:
  - Edge call returns `504` after ~150s (`qbo-sync-sales`).
  - Sales landing table has backlog: 71 `pending`, 272 `committed`, 0 `error`.
- Function is doing too much in one invocation (land + prefetch items + process all receipts/lines for a month), causing runtime over limit.

5) Why stock does not match QBO
- Sales sync logs show many: `No available stock for SKU ... order line created without stock unit`.
- Current data: 205 QBO sales lines, 186 with `stock_unit_id IS NULL`.
- So order lines are created, but stock closure often doesn’t happen.
- Also, item sync errors block SKU enrichment and quantity reconciliation paths for many SKUs.
- Net effect: channel quantities drift because QBO changes are not fully translated into stock movements in-app.

Implementation plan to fix

Step 1 — Database fix for item sync schema mismatch
- Add missing column on `public.sku`:
  - `qbo_parent_item_id text`
- Then force schema cache refresh.
- This unblocks both:
  - `supabase/functions/qbo-sync-items/index.ts`
  - `supabase/functions/qbo-webhook/index.ts`
  (both currently write `qbo_parent_item_id`).

Step 2 — Make item/webhook writes resilient to schema drift
- In `qbo-sync-items` and `qbo-webhook`, add a safe fallback:
  - if write fails with `qbo_parent_item_id`/`PGRST204`, retry same upsert/update without that field.
- This prevents full sync degradation if column drift recurs.

Step 3 — Eliminate qbo-sync-sales timeout with bounded processing
- Refactor `supabase/functions/qbo-sync-sales/index.ts` to process in chunks:
  - keep monthly filter, but process only N landed receipts per invocation (e.g. 25–50).
  - return `has_more`, `remaining_pending`, and `processed_count`.
- Keep landing table as source of pending work; do not try to fully drain a heavy month in one request.
- Update `src/pages/admin/QboSettingsPanel.tsx`:
  - for each month, loop invocations until `has_more=false` (or user presses Stop).
- Result: no 150s timeouts, deterministic progress, resumable sync.

Step 4 — Close stock for already-imported lines after sync stabilization
- Run/keep existing reconciliation, but ensure it is part of recovery after chunked sales sync.
- Prioritize relinking lines with `stock_unit_id IS NULL` where stock exists.
- Track recovered counts in response payload and admin toast for visibility.

Step 5 — Controlled QBO-authoritative quantity backfill (to meet “QBO is source of truth”)
- Add optional mode in reconciliation path (admin action) to create balancing stock units when `QBO QtyOnHand > app allocatable`.
- Mark these units with explicit provenance in `notes/source_system` for audit.
- Keep this behind an explicit flag so finance/costing impact is intentional.

Technical details (files to change)

- DB migration:
  - add `public.sku.qbo_parent_item_id text`
  - `NOTIFY pgrst, 'reload schema';`
- `supabase/functions/qbo-sync-items/index.ts`
  - fallback retry when `qbo_parent_item_id` is rejected
  - keep current logic otherwise
- `supabase/functions/qbo-webhook/index.ts`
  - same fallback pattern for item SKU upsert/update
- `supabase/functions/qbo-sync-sales/index.ts`
  - chunked processing contract (`limit`, `cursor/offset`, `has_more`)
  - process pending landings incrementally
- `src/pages/admin/QboSettingsPanel.tsx`
  - per-month sub-loop until chunked sync completes
  - preserve stop/cancel behavior
- Optional:
  - `supabase/functions/admin-data/index.ts` reconcile action: add explicit `backfill_from_qbo` mode

Validation plan

1) Re-run Sync Items
- Expect `landing_raw_qbo_item` errors to stop increasing; new run should produce committed rows.

2) Re-run Sync Sales
- Expect no 504.
- Month progress should advance in chunks and complete.

3) Verify backlog drains
- `landing_raw_qbo_sales_receipt` pending should approach 0.

4) Verify inventory alignment
- `sales_order_line` null `stock_unit_id` count should drop.
- Reconcile report should show reduced discrepancies and aligned channel quantities.

5) Spot-check high-frequency SKUs from warnings
- Confirm availability/listed_quantity now matches expected post-sales state.
