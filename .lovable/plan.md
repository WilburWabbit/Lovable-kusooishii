

# Fix Minifig BrickEconomy Market Data

## Root Cause

Two bugs preventing minifig market data from displaying:

### Bug 1: Product type mapping mismatch
The `product` table stores `product_type = 'minifigure'` for minifigs, but the mapper in `use-products.ts` only checks for `'minifig'`:
```typescript
// Current — misses "minifigure"
productType: ((row.product_type as string) === 'minifig' ? 'minifig' : 'set')
```
This causes all minifigure products to be mapped as `"set"`, so the chart queries `item_type = 'set'` instead of `'minifig'`.

### Bug 2: Hook adds wrong suffix for minifigs
The `useBrickEconomyPriceHistory` hook always appends `-1` to the base number:
```typescript
const versionedNumber = `${baseNumber}-1`; // "col130" → "col130-1"
```
Minifig item numbers in the DB are just `col130` (no suffix). The `.or()` query tries `col130` AND `col130-1` — the first would match, but since `item_type` is wrong (Bug 1), nothing returns.

## Fix

### File 1: `src/hooks/admin/use-products.ts` (line 34)
Change the product type check to also match `"minifigure"`:
```typescript
productType: (['minifig', 'minifigure'].includes(row.product_type as string) ? 'minifig' : 'set')
```

### File 2: `src/hooks/admin/use-brickeconomy.ts` (lines 40-41)
Skip the versioned number logic for minifigs (they don't use `-1` suffixes):
```typescript
const baseNumber = itemNumber.split("-")[0];
const numbers = itemType === "minifig"
  ? [baseNumber]
  : [baseNumber, baseNumber.includes("-") ? baseNumber : `${baseNumber}-1`];
```
Then update the `.or()` to use the dynamic array:
```typescript
.or(numbers.map(n => `item_number.eq.${n}`).join(","))
```

Both are small, targeted changes. No other files need modification.

