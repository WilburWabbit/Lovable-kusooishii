

# Fix: QBO Item Sync Fails on Re-grade

## Root Cause

Two issues found in the `qbo-sync-item` edge function:

1. **Type mismatch**: The function always sets `Type: "NonInventory"`, but the existing QBO items are type `Stock` (Inventory). QBO forbids changing an item's type, so every update to an existing item fails with `"Item of type Stock cannot be changed to Noninventory item type"`.

2. **Re-grade doesn't transfer QBO item ID**: When a set is re-graded from e.g. grade 2 → grade 3, the frontend creates/finds the new SKU (`76442-1.3`) but that new SKU has no `qbo_item_id`. The old SKU (`76442-1.2`) keeps the `qbo_item_id`. So the sync call for the new SKU tries to **create** a new QBO item instead of **updating** the existing one. Meanwhile the QBO item retains the old name/descriptions.

## Fix

### `supabase/functions/qbo-sync-item/index.ts`

**A) Preserve existing item type on update**: When updating an existing QBO item (i.e. `existingQboItemId` is set), read the current `Type` from the fetched item and use it in the payload. Only set `Type: "NonInventory"` when creating a brand new item.

**B) Support `oldSkuCode` parameter for re-grade**: Accept an optional `oldSkuCode` in the request body. When provided:
- Look up the old SKU's `qbo_item_id`
- Use that QBO item ID to **update** the existing QBO item with the new SKU code as `Name`, and new descriptions
- Transfer `qbo_item_id` from the old SKU to the new SKU
- Clear `qbo_item_id` on the old SKU

**C) Remove hardcoded `Type` on updates**: When doing a sparse update, omit `Type` entirely (QBO won't change it and won't reject).

### `src/hooks/admin/use-stock-units.ts`

Pass `oldSkuCode` to the `qbo-sync-item` invocation so the edge function knows to look up and transfer the QBO item:

```typescript
// Line ~304: pass oldSkuCode when re-grading
supabase.functions.invoke('qbo-sync-item', { 
  body: { skuCode, oldSkuCode: oldSkuCode ?? undefined } 
})
```

Remove the second fire-and-forget call for the old SKU (lines 312-318) since the single call now handles the transfer.

### Updated edge function logic

```text
1. Receive { skuCode, oldSkuCode? }
2. Fetch new SKU record → check qbo_item_id
3. If no qbo_item_id AND oldSkuCode provided:
   a. Look up old SKU → get its qbo_item_id
   b. Use that as existingQboItemId (transfer scenario)
4. If existingQboItemId → GET from QBO → read SyncToken + Type
5. Build payload:
   - Name = skuCode (new)
   - Description / PurchaseDesc = new product name + grade label
   - If updating: sparse=true, preserve Type from fetched item, omit account refs
   - If creating: Type = "NonInventory", include account refs
6. POST to QBO
7. Update new SKU with qbo_item_id
8. If oldSkuCode: clear qbo_item_id on old SKU
```

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-item/index.ts` | Preserve item type on update; accept `oldSkuCode` for QBO item transfer |
| `src/hooks/admin/use-stock-units.ts` | Pass `oldSkuCode` to single sync call; remove duplicate call |

