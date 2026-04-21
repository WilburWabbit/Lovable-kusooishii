

# Debug & Fix `ebay-push-listing`

## What's broken

The most recent eBay publish attempt (channel_listing `80a44cf1-…`, set 43269 Dalmatians, listed 2026-04-03) ended up with `v2_status='live'` and a `listed_at` timestamp but **no `external_listing_id`** — i.e. the front-end recorded "live" while the function silently failed. No edge-function logs exist for `ebay-push-listing` because the front-end calls it as fire-and-forget (`.catch(console.warn)`).

## Three actual bugs in `supabase/functions/ebay-push-listing/index.ts`

### 1. Crash on initial DB read (line 46) — the real failure cause

```ts
.select("*, product:product_id(mpn, name, description, ean, upc, hook)")
```

`product.upc` and `product.hook` **don't exist**. PostgREST returns `42703` and the function throws before ever reaching eBay. Real columns: `mpn, name, description, ean, product_hook` (no UPC at all).

### 2. Wrong column name `external_id` (lines 98, 176)

`channel_listing` has **no `external_id` column**. The eBay offer ID is meant to live in `external_listing_id` (used by `ebay-sync`, `ebay-import-payouts`, `qbo-sync-payout`, `admin-data` — every other function in the project). Effects:
- Line 98 (`existingExternalId = l.external_id`) is always null → the function always tries to create a fresh offer instead of updating an existing one.
- Line 176 (`update({ external_id: offerId })` ) silently writes to a non-existent column → the offer ID is never persisted, which is exactly what we see for the Dalmatians row.

### 3. Missing eBay marketplace policy secrets (lines 115-119)

`EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_LOCATION_KEY` are not set in project secrets. Once bug #1 is fixed the function will reach eBay and `POST /sell/inventory/v1/offer` will return a 400 because these come through as empty strings.

## Fix plan

### A. Edge function `supabase/functions/ebay-push-listing/index.ts`

1. **Fix the SKU/product select** (line 46): drop `upc`, rename `hook` → `product_hook`. Final list: `mpn, name, description, ean, product_hook`.
2. **Remove the UPC spread** (line 76) since the column doesn't exist.
3. **Replace both `external_id` references** with `external_listing_id`:
   - Line 98: `const existingExternalId = l.external_listing_id as string | null;`
   - Line 176: `external_listing_id: offerId,` (in the update payload).
4. **Hard-fail early if the four eBay policy env vars are unset**, so the user sees a clear 400 from the function instead of a 400 from eBay. Throw a single error listing all missing vars before building the offer payload.
5. **Use the shared `getEbayAccessToken` helper** in `_shared/ebay-auth.ts` (already implements the same flow with proper update conflict handling). Delete the duplicate local copy of the function.

### B. Front-end hook `src/hooks/admin/use-channel-listings.ts`

The current call is fire-and-forget with `console.warn` only. This is exactly why the user didn't see the failure. Change `usePublishListing` so the eBay branch:
- `await`s `supabase.functions.invoke('ebay-push-listing', …)`,
- if the response contains an error, surfaces it via `throw new Error(...)` so the calling mutation goes into `onError` and the user sees a toast.

### C. Add the four eBay marketplace secrets

Use `add_secret` to request `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_LOCATION_KEY`. The user must supply these — they come from the eBay seller account's business policies. Without them no offer can be published.

### D. Backfill the broken Dalmatians listing record

`80a44cf1-…` is currently `v2_status='live'` with no eBay ID. After the function is fixed:
- Reset it to `v2_status='draft'`, clear `listed_at`,
- Re-trigger the publish from the UI so it goes through the corrected path.

## Verification

1. Use `curl_edge_functions` to POST `/ebay-push-listing` with `{ listingId: "80a44cf1-…" }` while logged in.
2. Confirm the response contains `offerId` and `listingItemId`, and that the row now has a populated `external_listing_id` plus a real `external_url`.
3. Confirm a fresh entry appears in `edge-function-logs` for `ebay-push-listing` (currently completely empty — proof the function had been crashing before any `console.log`).

