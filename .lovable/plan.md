

# Fix eBay inventory desync after non-eBay sales

## What's actually broken

Right now **36 of 113 live eBay listings have stale `availableQuantity`** on eBay. Examples confirmed in the database:

| MPN / SKU | Available locally | Quantity on eBay listing | eBay listing ID |
|---|---|---|---|
| `31058-1.1` | 0 | 1 | 205909093672 |
| `60438-1.1` | 0 | 1 | 205906621862 |
| `42164-1.1` | 4 | 6 | 205913766372 |
| `40776-1.1` | 3 | 5 | 206027612951 |
| `10349-1.1` | 89 | 90 | 206005702262 |
| …30 more | | | |

Both `31058-1` and `60438-1` had their last units sold via the website / admin (orders `53d4e0be-…` and `c732ae09-…`), not eBay. Their stock_units are correctly marked `sold`/`complete` in the app, but eBay still shows `1` available, so they remain biddable/buyable on eBay even though we can't fulfil them.

## Root cause

There are three code paths that consume stock and mark units sold:

1. `ebay-process-order` — **does push updated quantity to eBay** (lines 1015-1023, calls `updateInventoryQuantity` and updates `channel_listing.listed_quantity`). This is why eBay-originated sales don't desync.
2. `stripe-webhook` (website checkout) — closes the stock unit, audits it, and **stops there**. No call to eBay.
3. `v2-process-order` (admin / generic post-order hook) — runs FIFO, links unit to order, **stops there**. No call to eBay.
4. Manual admin order completion in `admin-data` — same: updates local stock only.

`channel_listing.listed_quantity` is also never decremented in paths 2-4, which is why the mismatch query above finds 36 rows.

There is no trigger, cron, or hook that reconciles "stock units changed → push quantity to active eBay listings".

## The fix

### 1. New helper: `pushEbayInventoryQuantity(skuId)` — single point of truth

Add a small helper (in `supabase/functions/_shared/`, e.g. `ebay-inventory-sync.ts`) that:

- Looks up live `channel_listing` rows for `sku_id` where `channel='ebay'` and `external_listing_id` is not null.
- Counts available stock units (`v2_status IN ('graded','listed')`) for that SKU.
- For each listing, calls `PUT /sell/inventory/v1/inventory_item/{sku}` with the new `availability.shipToLocationAvailability.quantity`.
- Writes `channel_listing.listed_quantity` and `synced_at` locally on success.
- If quantity hits 0, also calls `POST /sell/inventory/v1/offer/{offerId}/withdraw` so the listing actually ends instead of just sitting at qty=0 (matches the "End listings when stock reaches zero" rule in the design spec).
- On failure: insert a row into `audit_event` with `category: 'ebay_stock_desync'` (same shape as `ebay-process-order` already does), so we don't silently fail again.

This consolidates the three near-identical copies of `updateInventoryQuantity` already living in `ebay-sync`, `ebay-process-order`, and `ebay-push-listing`.

### 2. Wire the helper into every non-eBay sales path

- **`stripe-webhook`** — after the `update({ status: "closed" })` of the stock unit (around line 743), collect each affected `sku_id` and at the end of the order processing block fire `pushEbayInventoryQuantity` for each unique SKU. Fire-and-forget with `.catch(audit)`; do NOT block the webhook response (Stripe needs a fast 200).
- **`v2-process-order`** — same pattern: after the `affectedSkus` set is built (it already exists at line 77/146), iterate it and call the helper.
- **`admin-data`** order-completion / shipment / write-off branches that flip a unit to `sold`, `shipped`, or `written_off` — call the helper for each affected SKU.
- **`v2-reconcile-payout`** — already touches units; safe to also nudge eBay quantity for any SKU it consumes (defensive, since reconciliation can also discover missed orders).

In all four cases the helper call is **non-blocking** (the order/payout/webhook must still succeed even if eBay is unreachable), but failures are recorded as `ebay_stock_desync` audit events so they're visible.

### 3. Backfill / repair the 36 currently desynced listings

Add a tiny one-shot admin endpoint or extend `ebay-sync` `action: "push_stock"` (which already exists and does exactly the right loop, lines 678-710) so the user can run it once now. Then call it from the admin UI Channels tab or simply trigger it via `curl_edge_functions`. This will:

- Push correct quantities for all 36 listings.
- Withdraw offers where the new quantity is 0 (this resolves `31058-1`, `60438-1`, and ~20 other zero-stock listings still live on eBay).

### 4. Safety net: nightly drift check

Add a cron (or extend the existing eBay sync schedule) to run the same comparison query nightly:

```text
local_available  vs  channel_listing.listed_quantity (per live ebay listing)
```

For any mismatch, call the helper. This catches edge cases (manual DB edits, failed pushes, eBay API outages) without manual intervention. Insert one summary `audit_event` per run.

## Files touched

| File | Change |
|---|---|
| `supabase/functions/_shared/ebay-inventory-sync.ts` | **NEW** — `pushEbayInventoryQuantity(admin, skuId)` helper |
| `supabase/functions/stripe-webhook/index.ts` | Call helper for each SKU after order paid |
| `supabase/functions/v2-process-order/index.ts` | Call helper for each SKU in `affectedSkus` |
| `supabase/functions/admin-data/index.ts` | Call helper from manual ship/complete/write-off branches |
| `supabase/functions/v2-reconcile-payout/index.ts` | Call helper after unit status updates |
| `supabase/functions/ebay-process-order/index.ts` | Refactor to use the shared helper (drop the local copy) |
| `supabase/functions/ebay-sync/index.ts` | Refactor `push_stock` action to use the shared helper; add a `withdraw if qty=0` branch |
| New cron job (SQL) | Nightly drift check that calls the shared push for any mismatch |

## Verification steps after deployment

1. Run the one-shot push and confirm `31058-1.1` and `60438-1.1` listings on eBay flip to ended/withdrawn (quantity 0).
2. Re-run the mismatch query — expect 0 rows.
3. Place a test website checkout for an item with stock=2 on eBay. After Stripe webhook fires, confirm eBay shows quantity=1 within ~10 seconds.
4. Manually mark a unit `written_off` in admin and confirm the corresponding eBay listing decrements.
5. Confirm `audit_event` rows of category `ebay_stock_desync` only appear when the eBay API genuinely fails.

