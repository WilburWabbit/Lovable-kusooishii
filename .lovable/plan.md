

## Debug: eBay Listing Issues

### Problem 1: "Success" toast but listing is PENDING / not on eBay

The edge function logs show:
```
Offer created: 133174619011
Publish failed: errorId 25007 — "invalid data in the associated fulfilment policy. Please add at least one valid postage service option"
```

The code catches the publish error silently (line 706-708 in `ebay-sync`), upserts the `channel_listing` as `PENDING`, and returns `{ success: true }`. The UI then shows "eBay listing created" without distinguishing success from partial failure.

**Root cause**: The offer is created without a `listingPolicies` object specifying `fulfillmentPolicyId`, `paymentPolicyId`, and `returnPolicyId`. eBay requires these for publishing. The offer body (lines 662-673) is missing them entirely.

**Fix in `supabase/functions/ebay-sync/index.ts`**:
1. Fetch the seller's business policies via `GET /sell/account/v1/fulfillment_policy?marketplace_id=EBAY_GB` (and similarly for payment/return policies) to get the policy IDs, OR accept them as stored configuration.
2. Add `listingPolicies` to the offer body:
   ```typescript
   listingPolicies: {
     fulfillmentPolicyId: "<id>",
     paymentPolicyId: "<id>",
     returnPolicyId: "<id>",
   }
   ```
3. If publish fails, propagate the error instead of silently swallowing it — change the `catch` to throw so the UI shows the real error.

**Approach**: Auto-fetch the first active policy of each type from the eBay Account API when creating the offer. Store/cache in memory or fetch each time (they rarely change). If no policies exist, throw a clear error.

**Fix in `ProductChannelsTab.tsx`**:
- No change needed for this issue once the backend properly throws on failure.

### Problem 2: eBay "Unlist" button removes the web listing instead

In `ProductChannelsTab.tsx` line 47, the `remove` action always calls `remove-web-listing` regardless of the channel:

```typescript
} else {
  await invokeWithAuth("admin-data", { action: "remove-web-listing", sku_id: skuId });
}
```

**Fix in `ProductChannelsTab.tsx`**:
- Branch on channel for the remove action, same as for create:
  ```typescript
  } else {
    if (ch === "ebay") {
      await invokeWithAuth("ebay-sync", { action: "remove_listing", sku_id: skuId });
      toast.success("eBay listing removed");
    } else {
      await invokeWithAuth("admin-data", { action: "remove-web-listing", sku_id: skuId });
      toast.success("Web listing removed");
    }
  }
  ```

**Fix in `supabase/functions/ebay-sync/index.ts`**:
- Add a `remove_listing` action handler that:
  1. Looks up the `channel_listing` for the SKU on eBay
  2. If it has an `external_listing_id`, calls `POST /sell/inventory/v1/offer/{offerId}/withdraw` to end the eBay listing
  3. Deletes or marks the `channel_listing` row as removed

### Summary of changes

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add `listingPolicies` (auto-fetched) to offer body; stop swallowing publish errors; add `remove_listing` action |
| `src/components/admin/product-detail/ProductChannelsTab.tsx` | Route eBay unlist to `ebay-sync` `remove_listing` instead of `remove-web-listing` |

