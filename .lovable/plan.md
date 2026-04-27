# Why the publish failed

The most recent attempt to publish SKU `5KFC3516BER` (KitchenAid Mini Food Chopper, eBay category `20673`) failed with:

> Cannot publish 5KFC3516BER to eBay: missing required aspects — Model. Set them in the Specifications tab.

## Root cause

There are two independent aspect-resolution paths in the codebase and they do not agree:

1. **Specifications tab (UI)** calls the `ebay-taxonomy` edge function action `resolve-aspects`, which uses `_shared/specs-resolver.ts`. That resolver:
   - reads `channel_attribute_mapping`
   - resolves each aspect's `canonical_key` against the `canonical_attribute` registry
   - reads the value from the mapped `product.<db_column>` (e.g. `product_name → product.name`)
   - falls back to `product_attribute` overrides
   
   For this product it correctly resolves `Model = "KitchenAid Mini Food Chopper - Empire Red"` because the DB mapping for category `20673` says `Model → product_name`.

2. **`ebay-push-listing`** edge function (the actual publisher) does NOT use that resolver. It only:
   - sets `MPN` from `product.mpn`
   - reads `product_attribute` rows in namespaces `core` and `ebay`
   - applies a hardcoded LEGO-only helper (`buildEbayAspects`) in some paths
   
   It never consults `channel_attribute_mapping`, so `Model` is empty at publish time even though the UI shows it as resolved. The "missing required aspects — Model" check then trips.

This also explains the broader frustration: every non-LEGO category, and any LEGO aspect that depends on a mapping rather than an explicit `product_attribute` row, will be reported as "missing" at publish even though the Specifications tab shows it populated.

## Fix

Make the publisher use the same resolver as the UI so the mapping table is the single source of truth.

### Changes

1. **`supabase/functions/ebay-push-listing/index.ts`**
   - Import `resolveSpecsForProduct` from `_shared/specs-resolver.ts`.
   - After determining `productId`, `marketplace`, and `ebayCategoryId`, call the resolver to get the canonical row set.
   - Build the `aspects` payload from `row.effectiveValue` for every row that has a value (single → `[value]`, multi/array → array of strings).
   - Drop the ad-hoc `product_attribute`-only loop and the `MPN`-from-product default — both are subsumed by the resolver.
   - Replace the local "missing required aspects" check with the resolver's own `missingRequiredCount` / per-row `required && !effectiveValue` data so the error message lists exactly the same aspects the user sees in the Specifications tab.
   - Keep the existing "no images" and policy-env validations untouched.

2. **`supabase/functions/_shared/channel-aspect-map.ts`**
   - Mark `buildEbayAspects` as deprecated (kept only for any remaining callers; not used by the publisher anymore). No behaviour change required in this PR.

3. **No DB migration** — the mapping for Model on category `20673` already exists and is correct.

### Verification after deploy

- Re-publish `5KFC3516BER`: the publish should succeed (or fail on a genuine eBay-side issue, not the local validator).
- Re-publish a LEGO SKU: `MPN`, `Brand` (constant), `LEGO Set Number`, `LEGO Theme`, `Year Manufactured`, etc. should all populate from mappings without manual `product_attribute` rows.
- The Specifications tab and the publish error list should now reference the exact same set of missing aspects.

### Out of scope

- Any cleanup of duplicate canonical fields, mapping audit, or UI of the Specifications tab — those were addressed in earlier passes and are not the cause of this specific failure.
