

# Re-grading: SKU Reassignment + QBO & Channel Sync

## Problem

When re-grading a stock unit that already has a SKU, the current code (line 144 of `use-stock-units.ts`) explicitly prevents SKU reassignment: *"If the unit already has a SKU, keep it — never change an existing SKU assignment."* This was correct for minor edits but wrong for actual grade changes on sets, where SKU = `MPN.grade` and must change.

Additionally, when the SKU changes, QBO and channel listings need updating:
- **QBO Item**: The `Name`, `Description` (sale description containing product name + grade label), and `PurchaseDesc` all contain the SKU code and must be updated
- **Channel listings**: Any live listings linked to the old SKU must be reassigned to the new SKU

## Scope

This applies to **sets only** (not minifigs, which don't use grade-based SKUs in the same way). The `product_type` on the product record distinguishes these.

## Changes

### 1. `src/lib/types/admin.ts` — Add new condition flags + notes

- Add `'stickers_applied' | 'missing_minifigs' | 'missing_instructions'` to `ConditionFlag`
- Add `notes: string | null` to the `StockUnit` interface

### 2. `src/lib/constants/unit-statuses.ts` — New flag entries

Add three entries to `CONDITION_FLAGS` array:
- `{ value: 'stickers_applied', label: 'Stickers applied' }`
- `{ value: 'missing_minifigs', label: 'Missing minifigs' }`
- `{ value: 'missing_instructions', label: 'Missing instructions' }`

### 3. `src/hooks/admin/use-stock-units.ts` — Allow SKU reassignment on re-grade

The core logic change. When a unit **already has a `sku_id`** and the grade is changing:

1. Map `notes` in `mapStockUnit`
2. Accept `notes` in `GradeInput`
3. Remove the guard that skips SKU work when `existingSkuId` is set
4. Compare old grade vs new grade — if different:
   - Find or create the new SKU (`MPN.newGrade`)
   - Reassign `sku_id` on the stock unit to the new SKU
   - Fire-and-forget call to `qbo-sync-item` with the **new** SKU code
   - Fire-and-forget call to `qbo-sync-item` with the **old** SKU code (to update its QBO Name/Description if needed, or just to keep it in sync)
   - Move any `channel_listing` rows from old SKU to new SKU (update `sku_id` and `external_sku`)
5. Include `notes` in the stock unit update payload

### 4. `supabase/functions/qbo-sync-item/index.ts` — Update Name + Descriptions

The function already builds `Name` and `Description` from the SKU code. Add `PurchaseDesc` to the payload so all three fields stay in sync:

```typescript
itemPayload.PurchaseDesc = `${productName} — ${gradeLabel}`;
```

No other changes needed — the function already handles create vs update via `existingQboItemId`.

### 5. `src/components/admin-v2/GradeSlideOut.tsx` — Add notes textarea

- Add `notes` state (pre-populated from `unit.notes`)
- Render a `<textarea>` below condition flags labelled "Notes"
- Pass `notes` through to the grade mutation

### 6. `src/components/admin-v2/StockUnitsTab.tsx` — Replace UnitDetailSlideOut with GradeSlideOut

- Import `GradeSlideOut` instead of `UnitDetailSlideOut`
- Replace the component, passing the selected unit
- Change button text from "View" to "Edit"

## Technical Detail

**SKU reassignment flow** (in `useGradeStockUnit`):

```text
1. Fetch unit → get current sku_id, mpn, condition_grade
2. Compute oldSku = mpn.oldGrade, newSku = mpn.newGrade
3. If grade unchanged → skip SKU work (just update flags/notes)
4. If grade changed:
   a. Find-or-create new SKU record
   b. UPDATE stock_unit SET sku_id = newSkuId, condition_grade = newGrade
   c. UPDATE channel_listing SET sku_id = newSkuId, external_sku = newSkuCode WHERE sku_id = oldSkuId
   d. Fire qbo-sync-item for newSkuCode (updates QBO Name/Description/PurchaseDesc)
   e. Recalculate old SKU's qty (may need to end listings if qty = 0)
```

**Channel listing update**: Only listings with `v2_status = 'live'` or `'draft'` are reassigned. Ended/sold listings stay on the old SKU for historical accuracy.

## Files changed

| File | Change |
|------|--------|
| `src/lib/types/admin.ts` | Add 3 condition flags, add `notes` to `StockUnit` |
| `src/lib/constants/unit-statuses.ts` | Add 3 flag entries |
| `src/hooks/admin/use-stock-units.ts` | SKU reassignment logic, notes support |
| `src/components/admin-v2/GradeSlideOut.tsx` | Add notes textarea |
| `src/components/admin-v2/StockUnitsTab.tsx` | Replace `UnitDetailSlideOut` with `GradeSlideOut` |
| `supabase/functions/qbo-sync-item/index.ts` | Add `PurchaseDesc` to payload |

