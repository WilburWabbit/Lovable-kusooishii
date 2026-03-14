

## Fix: Allow listing creation with calculated pricing

### Problem
The `create-web-listing` action checks `sku.price` in the database, but pricing results are only displayed in the UI (stored in `pricingResults` state) and never persisted to `sku.price` until a listing exists. This creates a catch-22 for new listings.

### Changes

**1. `supabase/functions/admin-data/index.ts` (lines ~357-392)**
- Accept optional `listed_price` parameter
- Use `listed_price` if provided, fall back to `sku.price`
- Reject only if neither yields a value > 0
- Update `sku.price` with the resolved price

```typescript
const { sku_id, listed_price } = params;
// ... fetch sku ...
const finalPrice = listed_price ?? sku.price;
if (!finalPrice || finalPrice <= 0) throw new ValidationError("Cannot list: no valid price...");

// Sync price to sku table
await admin.from("sku").update({ price: finalPrice }).eq("id", sku_id);

// Use finalPrice in the upsert
```

**2. `src/components/admin/product-detail/ProductChannelsTab.tsx` (line ~36)**
- Pass `target_price` from `pricingResults` when creating a listing

```typescript
const pricingKey = `${skuId}:${ch}`;
const pricing = pricingResults[pricingKey];
await invokeWithAuth("admin-data", {
  action: "create-web-listing",
  sku_id: skuId,
  listed_price: pricing?.target_price ?? undefined,
});
```

### Files
- `supabase/functions/admin-data/index.ts` — accept + resolve `listed_price`
- `src/components/admin/product-detail/ProductChannelsTab.tsx` — pass calculated price

