

## Strip SKU suffix from QBO item names

### Problem
QBO item names often contain the SKU in parentheses at the end, e.g. `"LEGO Star Wars Minifig Darth Vader (sw0123.2)"`. When creating standalone SKUs (no catalog match), the raw QBO name is used as `sku.name`, which looks messy.

### Change
Add a helper function `cleanQboName(name: string): string` that strips a trailing `(...)` pattern and trims whitespace. Apply it wherever `line.description` is used as the SKU name fallback.

```typescript
function cleanQboName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
```

### Files to edit

**1. `supabase/functions/qbo-sync-purchases/index.ts`**
- Add `cleanQboName` helper function
- Line ~166: change `name: line.description ?? mpn` to `name: cleanQboName(line.description ?? mpn)`

**2. `supabase/functions/process-receipt/index.ts`**
- Add same `cleanQboName` helper function
- Line ~140: change `name: line.description ?? mpn` to `name: cleanQboName(line.description ?? mpn)`

