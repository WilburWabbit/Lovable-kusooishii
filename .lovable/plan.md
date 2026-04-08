

# Re-grade: QBO Item Name Format + Inventory Adjustment

## Changes

### 1. `supabase/functions/qbo-sync-item/index.ts`

**A) Update Name format** (line 104)

Change `Name` from `skuCode` to `<productName> (<skuCode>)`:

```typescript
Name: `${productName} (${skuCode})`,
```

`Description` and `PurchaseDesc` remain as `${productName} — ${gradeLabel}`.

**B) Inventory Adjustment on SKU transfer**

Only when `transferFromOldSku` is true (meaning the old SKU already had a `qbo_item_id` that we're transferring), AND the existing QBO item type is `Inventory` (Stock):

After the item update succeeds (step 5), add a new step between 7 and 8:

1. Re-fetch the old QBO item to get its current `QtyOnHand`
2. If `QtyOnHand > 0`, POST an `InventoryAdjustment` to QBO with two line items:
   - **Decrease** old QBO item by the qty
   - **Increase** new QBO item (now updated with new name) by the same qty
3. Use the Inventory Shrinkage account ref (will need to look up the correct account value from QBO config or use a standard one)
4. Log the adjustment result; don't fail the whole operation if adjustment fails (fire-and-forget with error logging)

### 2. No frontend changes needed

The hook already passes `oldSkuCode`. The Name format change and stock adjustment are entirely server-side.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-item/index.ts` | Name → `Product (SKU)` format; add inventory adjustment on transfer |

