

## Plan: Fix Stale Listing Data on Re-list

### Root Cause

The `create-web-listing` action uses an **upsert** with `onConflict: "channel,external_sku"`. This means if the previous `remove-web-listing` (which deletes by `sku_id + channel`) doesn't fully remove the row -- or if the row gets recreated by another code path like `ensure-channel-listing` -- the upsert **only overwrites the fields it specifies** and leaves old values for:

- `listing_title`
- `listing_description`  
- `price_floor`, `price_target`, `price_ceiling`
- `confidence_score`, `pricing_notes`
- `listed_price` (set from `sku.price`, which may be the old calculated price)

### Fix

Update the `create-web-listing` upsert in `supabase/functions/admin-data/index.ts` to explicitly **null out** all override and pricing fields, ensuring a clean slate:

```typescript
// In the upsert payload, add:
listing_title: null,
listing_description: null,
price_floor: null,
price_target: null,
price_ceiling: null,
confidence_score: null,
pricing_notes: null,
priced_at: null,
```

This ensures that even if the upsert matches an existing row, all stale data is cleared.

### Additional: Fix Build Errors

The build has 18 TypeScript errors across multiple edge functions (pre-existing, not caused by recent changes). These are all `err is of type 'unknown'` and implicit `any` type errors. Each needs a cast like `(err as Error).message` or explicit type annotations. Files affected:

- `admin-data/index.ts` (line 1038)
- `brickeconomy-sync/index.ts` (lines 272, 276)
- `create-checkout/index.ts` (line 245)
- `ebay-sync/index.ts` (lines 893-896) -- needs interface for subscription object
- `import-product-data/index.ts` (line 199)
- `import-sets/index.ts` (line 166)
- `process-receipt/index.ts` (line 207)
- `qbo-sync-tax-rates/index.ts` (line 230)
- `stripe-webhook/index.ts` (lines 28-29, 86, 90) -- also needs `any` type for line items
- `sync-media-from-hub/index.ts` (line 108)

All will use `(err as Error).message` or explicit type annotations to resolve.

