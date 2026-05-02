## Root cause

Both publish attempts (web + ebay) for product `eee4c676-f29a-40fb-9d45-a41c4301ed5b` (SKU `31157-1.1`) failed at the INSERT into `channel_listing` with the Postgres error:

```
null value in column "external_sku" of relation "channel_listing"
violates not-null constraint
```

(Confirmed in postgres logs at 2026-05-02 08:15:14 and 08:15:16 UTC.)

### Why

- `channel_listing.external_sku` is declared `NOT NULL` with no default.
- The publish hook `usePublishListing` (`src/hooks/admin/use-channel-listings.ts`) builds an INSERT payload that omits `external_sku`.
- The hook's UPDATE branch works because it never touches the column, but this product had **no pre-existing `channel_listing` row**, so both publish attempts went through the INSERT branch and were rejected.
- No `outbound_command` rows were ever created — the failure happens before the snapshot/queue RPCs run.

This is a generic bug: any first-time publish for any (sku, channel) pair will fail the same way.

## Fix

Populate `external_sku` on the INSERT payload in `usePublishListing`. The natural value is the SKU code we already looked up (e.g. `31157-1.1`), which is what the eBay/sync code uses elsewhere as the external SKU identifier.

### Change

In `src/hooks/admin/use-channel-listings.ts` (around lines 240–299):

1. Extend the SKU lookup to also select `sku_code` (we already have it from the input as `skuCode`, but read from DB for safety so we use the canonical value).
2. Add `external_sku: skuCode` to the `payload` object so it is set on INSERT.
3. Leave the UPDATE branch as-is (don't overwrite an existing `external_sku` that may have been set by a prior eBay/web sync to a marketplace-assigned value).

To prevent this whole class of bug, also relax the column to allow a default fallback at the DB level:

- New migration: alter `channel_listing.external_sku` to default to the related `sku.sku_code` via a `BEFORE INSERT` trigger when the caller doesn't supply one. (Keep `NOT NULL`, but populate it automatically.)

### After deployment

Manually retry the publish for SKU `31157-1.1` on both `web` and `ebay` from `/admin/products/<id>` → Channels tab. The fix will create the `channel_listing` rows, generate price decision snapshots, and enqueue `publish` commands into `outbound_command` for the `listing-command-process` worker to pick up.

## Files touched

- `src/hooks/admin/use-channel-listings.ts` — add `external_sku: skuCode` to insert payload.
- `supabase/migrations/<new>.sql` — `BEFORE INSERT` trigger on `channel_listing` defaulting `external_sku` from `sku.sku_code` when null.

No other components, RPCs, or edge functions need changes.