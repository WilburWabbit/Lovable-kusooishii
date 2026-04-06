
Rebuild from QBO needs to become a true fresh snapshot + replay, not “delete canonical rows and reuse whatever is already in landing”.

What I found
- The current rebuild only wipes canonical rows and resets landing rows to `pending`. It does not refresh landing from live QBO first, so deleted QBO purchases/customers/sales receipts are being rebuilt from stale landing data.
- The QBO sync functions upsert records they still see, but they do not remove or tombstone landing rows for records that no longer exist in QBO.
- Delete tombstones are only handled properly for SalesReceipts and Vendors. Purchases, Customers, and Items still do not clean up canonical data when QBO deletes them.
- Channel codes are inconsistent:
  - Stripe/web checkout uses `web`
  - QBO processor creates `website`
  - in-person uses `in_person`
  - QBO processor creates `square`
  This breaks dedup, payout reconciliation, and channel attribution.
- QBO-created orders use `origin_reference = qboId` instead of the real external order/payment reference, so later eBay/website/in-person matching cannot reconnect them.
- Rebuild only replays the QBO processor. It does not replay Stripe/eBay landing flows afterward, so payout and order statuses stay wrong.
- Tax sync still writes canonical tax rows directly instead of going through the staged processor.

Plan

1. Replace rebuild with a fresh QBO snapshot pipeline
- In `admin-data`, change `rebuild-from-qbo` so it:
  1. clears all QBO landing tables
  2. re-fetches current QBO data into landing
  3. wipes QBO-derived/transactional canonical data
  4. replays processing in the correct order
  5. replays non-QBO landing data
  6. runs final integrity checks
- Update `QboSettingsCard` so the rebuild button drives these phases instead of just reset + `qbo-process-pending`.

2. Make landing authoritative during rebuild
- Update `qbo-sync-customers`, `qbo-sync-items`, `qbo-sync-vendors`, `qbo-sync-purchases`, `qbo-sync-sales`, and tax sync so rebuild mode produces a fresh landing snapshot rather than an additive merge.
- Land tax codes as well as tax rates.
- Stop direct canonical tax writes during sync; land first, process second.

3. Finish delete handling in the processor
- In `qbo-process-pending`, add explicit `_deleted` logic for:
  - Purchases: remove/reconcile receipt + stock correctly
  - Customers: remove QBO-mastered customers or clear QBO linkage where appropriate
  - Items: deactivate/remove QBO-derived SKU mappings
  - Tax entities: rebuild `tax_code` and `vat_rate` from staged data
- Keep replay chronological for transactions: purchases oldest→newest, then order enrichment/sales.

4. Normalize internal channel values
- Standardize canonical `origin_channel` values used everywhere:
  - `ebay`
  - `web`
  - `in_person`
  - other marketplaces only where genuinely needed
- Change QBO channel detection to map:
  - eBay DocNumber pattern → `ebay`
  - `KO-` / Stripe indicators → `web`
  - Square/cash/in-person indicators → `in_person`
- Update any read paths and payout logic to accept old values during transition, but rebuild all new rows with the normalized values only.

5. Change QBO sales import to match-first, create-last
- QBO SalesReceipts should:
  - match an existing eBay/website/in-person order first
  - enrich that order with QBO ids/status
  - only create a fallback order if no source order exists
- Use the real external channel reference as `origin_reference` when available, not the QBO receipt id.
- Keep the QBO receipt id only in `qbo_sales_receipt_id`.

6. Preserve only non-QBO-mastered data, then re-associate it
- Preserve:
  - product/media/copy by `mpn`
  - SKU-linked non-QBO config by `sku_code` / `external_sku`
  - local-only customer identity fields by email / `user_id` / `stripe_customer_id`
- Re-associate after rebuild:
  - rebuilt SKUs relink to existing product/media by `mpn`
  - retained listing/config rows relink to new `sku_id` by `sku_code`
  - local-only customers remain; QBO customers merge into them when keys match
- Delete anything retained that cannot be re-associated cleanly.

7. Replay non-QBO sources after QBO purchases are rebuilt
- After QBO reference/tax/purchase replay, replay:
  - Stripe landing events
  - eBay order landing
  - eBay payout landing
- Then run payout reconciliation so statuses and payout links are rebuilt against the fresh stock/order set.

8. Add targeted repair tools so one bad record does not require another full rebuild
- Add admin actions to purge + replay:
  - one QBO purchase
  - one QBO sales receipt
  - one QBO customer
  - one payout reconciliation run
- These should reuse the same cleanup/rebuild rules as the full rebuild.

Technical details
- Main files:
  - `supabase/functions/admin-data/index.ts`
  - `src/components/admin-v2/QboSettingsCard.tsx`
  - `supabase/functions/qbo-process-pending/index.ts`
  - `supabase/functions/qbo-sync-customers/index.ts`
  - `supabase/functions/qbo-sync-items/index.ts`
  - `supabase/functions/qbo-sync-vendors/index.ts`
  - `supabase/functions/qbo-sync-purchases/index.ts`
  - `supabase/functions/qbo-sync-sales/index.ts`
  - `supabase/functions/qbo-sync-tax-rates/index.ts`
  - `supabase/functions/v2-reconcile-payout/index.ts`
- If needed, add a small migration for rebuild locking/run tracking so two rebuilds cannot overlap.

Expected outcome
- Old QBO purchases/customers/items stop reappearing
- Deleted QBO customers disappear unless they are truly local-only
- eBay / website / in-person attribution becomes consistent
- QBO sales receipts enrich the correct operational orders instead of creating duplicates
- payout and order statuses rebuild correctly because non-QBO landings are replayed after the QBO stock base is restored
