

## Plan: Add Pricing Safeguards to Prevent £0.00 Listings

### Root Cause

Two issues allow items to be listed at £0.00:

1. **`create-web-listing`** sets `listed_price: sku.price`. If `sku.price` is `null` or `0` (e.g. the SKU was never priced, or price was cleared during a previous re-list), it publishes at £0.00 with no validation.

2. **`update-listing-prices`** auto-price logic checks threshold deltas but never validates the resulting price against the floor price. A target price of £0 would pass if the config allows it.

There is no server-side guard anywhere that prevents a `PUBLISHED` listing from having a zero or below-floor price.

### Changes

#### 1. `create-web-listing` — Block listing with no valid price (`supabase/functions/admin-data/index.ts`)

After fetching the SKU, reject the request if `sku.price` is null, zero, or negative:

```typescript
if (!sku.price || sku.price <= 0) {
  throw new Error("Cannot list: SKU has no valid price. Calculate pricing first.");
}
```

#### 2. `update-listing-prices` — Floor price guard (`supabase/functions/admin-data/index.ts`)

Before applying `listed_price` in the auto-price logic, validate against the floor:

```typescript
// After deciding to set updates.listed_price = price_target:
if (price_floor != null && price_target < price_floor) {
  auto_price_applied = false;
  auto_price_reason = `Target £${price_target} is below floor £${price_floor}. Skipped.`;
  delete updates.listed_price;
}
```

This check goes after the threshold checks but before finalizing `auto_price_applied`.

#### 3. `update-listing-prices` — Reject zero/negative prices

Add a general guard at the top of the auto-price block:

```typescript
if (price_target <= 0) {
  auto_price_reason = "Target price is zero or negative. Skipped.";
}
```

#### 4. Frontend — Show toast when listing is blocked (`ProductChannelsTab.tsx`)

No structural changes needed. The existing `toast.error(err.message)` in `handleListingAction` will surface the new server-side error message ("Cannot list: SKU has no valid price").

### Summary of Safeguards

| Scenario | Current | After |
|---|---|---|
| List SKU with null/zero price | Lists at £0.00 | Error: "no valid price" |
| Auto-price target below floor | Applied anyway | Skipped with reason |
| Auto-price target is £0 | Applied | Skipped with reason |
| Manual re-list after unlist (price cleared) | £0.00 published | Blocked until priced |

No database changes needed. Two files edited: `admin-data/index.ts` and minor defensive messaging only.

