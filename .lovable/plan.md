

# Add "On Hand" Column, Replace "Unsold" in Product List

## What changes

"On Hand" = unlisted + unsold (i.e. all stock that hasn't been sold yet — graded + listed units). This replaces the "Unsold" column which only showed listed-but-not-sold units.

## Files

### 1. `src/hooks/admin/use-products.ts`
- Add `onHand: number` to the `ProductStockCounts` interface
- In the counting loop, compute `onHand = unlisted + unsold` (graded + listed units)

### 2. `src/components/admin-v2/ProductList.tsx`
- Add `onHand` to the `ProductRow` interface (it comes from `ProductStockCounts`)
- Remove the `unsold` column definition from `COLUMNS`
- Add a new `onHand` column in its place with amber colouring when > 0, positioned where "Unsold" was
- Update `getValue` if needed (standard field access works)

No other files change. The "Unsold" data is still computed in the hook (other consumers may use it) — we just swap which column is shown in the product list.

