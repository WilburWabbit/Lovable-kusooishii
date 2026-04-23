

# Fix: New purchase batch creation fails with `sku_id NOT NULL` violation

## What broke

The most recent attempt (PO-667, John Pye, MPN `76140-1` × 1 @ £7.00) created the batch header and one purchase_line_item row, but the stock_unit insert failed with:

```
ERROR: null value in column "sku_id" of relation "stock_unit" violates not-null constraint
```

PO-667 is now an orphan in the DB (header + 1 line, **0 stock units**, status `draft`). The UI almost certainly showed a generic error. This will fail for **every** purchase created through the new form.

## Root cause

`useCreatePurchaseBatch` in `src/hooks/admin/use-purchase-batches.ts` (lines 330–351) inserts stock_unit rows like this:

```ts
{ mpn, batch_id, line_item_id, v2_status: 'purchased', status: 'pending_receipt' }
```

But the `stock_unit` table requires:

| column | nullable | provided? |
|---|---|---|
| `sku_id` (uuid) | NO | ❌ missing |
| `condition_grade` (enum) | NO | ❌ missing |
| `mpn` | NO | ✅ |
| `uid` | yes | ❌ (other paths reserve via `v2_reserve_stock_unit_uids`) |

The hook auto-creates a `product` row for new MPNs but never creates the corresponding `sku` row (or looks one up). The QBO sync (`qbo-process-pending`) and the receipt processor (`process-receipt`) both find-or-create a SKU and then attach `sku_id` + `condition_grade` to each unit — the new form simply skipped this step.

Compounding the problem: at intake the user hasn't graded yet, so we don't actually know the final grade. The existing intake/grading flow handles regrading later, but the schema still demands a non-null grade up front.

## The fix

### 1. `src/hooks/admin/use-purchase-batches.ts` — make `useCreatePurchaseBatch` SKU-aware

For every distinct MPN in the batch:

1. Find or create the `product` row (already done).
2. Find or create a **placeholder SKU** at the "ungraded" intake grade. Use `condition_grade = 5` (non-saleable / ungraded — the only grade that doesn't expose the unit to listings) with `sku_code = '<mpn>.5'`, `saleable_flag = false`, `active_flag = true`, `product_id = <new product id>`. This matches what the design spec already calls "grade 5 (non-saleable)" and keeps the unit invisible to listing/pricing logic until it's properly graded in `IntakeView` / `GradeSlideOut`.
3. Reserve UIDs via `supabase.rpc('v2_reserve_stock_unit_uids', { p_batch_id, p_count })` — same call already used by both other ingestion paths — so the new units get proper UIDs and `unit_counter` is updated atomically.
4. Insert each stock_unit with `sku_id`, `condition_grade: '5'`, `uid: reservedUids[i]`, `landed_cost: unit_cost` (apportionment RPC will refine), plus the existing `mpn / batch_id / line_item_id / v2_status: 'purchased' / status: 'pending_receipt'`.
5. If any step fails, roll back: delete inserted stock_units → purchase_line_items → batch (mirror `process-receipt`'s rollback at lines 234–238).

The grading flow already updates `sku_id` and `condition_grade` when a unit is graded, so once the user grades a unit through `GradeSlideOut`, it gets re-pointed to the correct `<mpn>.<grade>` SKU. Verify that path actually does this — if it currently only updates `condition_grade`, also update `sku_id` to match the new grade's SKU (find-or-create `<mpn>.<grade>`).

### 2. Repair PO-667

The header and one line item exist with no units. Rather than leave it orphaned, delete it cleanly so the user can re-enter the purchase through the now-fixed form:

- delete `purchase_line_items where batch_id='PO-667'`
- delete `purchase_batches where id='PO-667'`

(One-shot SQL migration.)

### 3. Surface the error in the UI

The mutation currently throws but the form likely shows a vague "Something went wrong" toast. In `NewPurchaseForm.tsx` (and/or wherever the mutation's `onError` lives), surface `error.message` in the toast so this kind of schema failure is immediately visible next time instead of silently leaving an orphan batch.

## Files touched

| File | Change |
|---|---|
| `src/hooks/admin/use-purchase-batches.ts` | Find-or-create SKU per MPN at grade 5, reserve UIDs, include `sku_id`/`condition_grade`/`uid`/`landed_cost` on stock_unit insert, add rollback |
| `src/components/admin-v2/NewPurchaseForm.tsx` | Toast `error.message` on failure |
| `src/components/admin-v2/GradeSlideOut.tsx` (or `use-stock-units.ts` `useGradeStockUnit`) | Verify/ensure regrade also updates `sku_id` to the new `<mpn>.<grade>` SKU (find-or-create) |
| New migration | Delete orphaned PO-667 |

## Verification

1. Create a new purchase via the form for an MPN that has no existing SKU (e.g. retry `76140-1 × 1 @ £7.00`). Expect: batch created, line item created, **1 stock_unit at grade 5 with `sku_id` set and a `uid`**, no error.
2. Grade that unit to grade 3 in `GradeSlideOut`. Confirm `stock_unit.condition_grade = 3` and `stock_unit.sku_id` now points to a `76140-1.3` SKU row.
3. Run a second purchase for the same MPN — should reuse the existing grade-5 SKU rather than duplicate.
4. Re-run the database error log query for the past hour and confirm zero `null value in column "sku_id"` errors.

