
# Fix silent eBay publish failures + missing image push + title override

## Root cause (confirmed from edge-function logs for offer 155956152011)

`ebay-push-listing` swallows **all** eBay errors whose message contains the substring `"25002"`, treating them as "already published". eBay's `25002` is a generic catch-all for any user-input validation error — including the actual failure here: **"Add at least 1 photo"**. Because we never push image URLs in the inventory item payload, every first-time publish for a SKU without an image already on the inventory record fails 25002 → gets swallowed → returned as `{success: true}` → green toast. Meanwhile the unpublished offer sits in eBay Seller Hub as a draft.

The "title override didn't persist" symptom is downstream of the same incident — I need to confirm whether `channel_listing.listing_title` actually saved before deciding if there is a second bug in the read path.

## Changes

### 1. `supabase/functions/ebay-push-listing/index.ts` — stop swallowing real errors

Replace the over-broad `25002` catch with a precise check for the actual "already published" sub-message that eBay returns. eBay's "offer is already published" response includes the literal phrase `"already published"` *or* the longer message `"This offer is already published"` — match those, not the bare error code.

```ts
} catch (pubErr) {
  const errMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
  const isAlreadyPublished =
    errMsg.includes("409") ||
    /already\s+published/i.test(errMsg) ||
    /offer.*already.*active/i.test(errMsg);
  if (isAlreadyPublished) {
    console.log(`eBay offer ${offerId} already published — continuing`);
  } else {
    throw pubErr;  // surfaces to the toast via errorResponse
  }
}
```

This alone would have made the original failure visible: the toast would have shown "Add at least 1 photo" instead of green-checking.

### 2. `supabase/functions/ebay-push-listing/index.ts` — push images on the inventory item

Look up shared media for the SKU/product and include `imageUrls` on the PUT `inventory_item` payload. Order:

1. Read `product_media` joined to `media_asset` for the product, ordered by `is_primary desc, sort_order asc`.
2. Pull `original_url` (must be a public HTTPS URL — Supabase Storage `media` bucket is already public, ✅).
3. Add to the payload:

```ts
product: {
  title: …,
  description: …,
  aspects: { Brand: ["LEGO"], MPN: [product?.mpn ?? ""] },
  ...(product?.ean ? { ean: [product.ean] } : {}),
  ...(imageUrls.length > 0 ? { imageUrls } : {}),
},
```

If `imageUrls` is empty, fail fast with a clear error before calling eBay:

```ts
if (imageUrls.length === 0) {
  throw new Error(`Cannot publish ${effectiveSku} to eBay: no product images uploaded. Add at least one image in Copy & Media first.`);
}
```

### 3. Confirm + fix the title override

Verify after the publish path is fixed:

- Read the existing `channel_listing` row for SKU `31172-1.1` to confirm whether `listing_title` saved on the failed attempt.
- If saved: the persistence bug doesn't exist — the user's perception is because the publish "succeeded" but the offer is unpublished on eBay (showing eBay's auto-generated draft title in Seller Hub, not our override). Reverifying after the fix above will resolve it.
- If not saved: trace the read in `ChannelsTab.tsx` to see if it falls back to `product.name` when `listing_title` is null on a re-fetch (e.g. cache invalidation issue after the failed publish overwrites with `null`).

I will read the row first thing in default mode and only patch the read path if the column is actually empty.

### 4. Repair PO-affected listing for `31172-1.1`

After the fix, the existing offer `155956152011` is still sat in eBay as an unpublished draft. The user can:

- Go to the product → Channels tab → click **Update Listing** again. The new code will:
  - PUT inventory item *with* imageUrls
  - PUT (not POST) the existing offer
  - POST publish → this time it will succeed (or surface a real error)

No DB cleanup needed — the existing `external_listing_id` is the same offer ID and eBay will accept the republish.

## Verification

1. Click **List on eBay** for `31172-1.1` with no images uploaded → red toast: "Cannot publish … no product images uploaded".
2. Upload an image, click **List on eBay** again → green toast, listing visible at the returned `external_url` on ebay.co.uk.
3. Set a custom title override, publish, refresh → override persists in the Channels tab and on the live eBay listing.
4. Re-publish the same SKU → green toast, no duplicate offer, "already published" path still works.

## Files touched

- `supabase/functions/ebay-push-listing/index.ts` — narrow the publish-error catch + add image lookup + payload `imageUrls` + pre-flight image check.
- (Conditional) `src/components/admin-v2/ChannelsTab.tsx` — only if step 3 reveals a read-side fallback bug.

## Out of scope

- Aspects beyond Brand/MPN (Theme, Piece Count, etc.) — separate eBay Cassini-quality improvement, not the cause of this failure.
- Backfilling other listings that may have silently failed in the past — can be done as a one-off query after the fix lands if you want.
