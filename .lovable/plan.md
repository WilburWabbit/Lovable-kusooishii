

# Revised Plan: QBO Data Integrity — Harden, Error UI, and Full Reset

## Part 1: Harden the Processor (unchanged from prior plan)

### File: `supabase/functions/qbo-process-pending/index.ts`

- **Rollback-on-error for purchases**: Track created stock unit IDs; if any line fails, delete all partial stock and receipt lines created in that iteration before marking as `error`.
- **Rollback-on-error for sales receipts**: Use `cleanupSalesOrder` consistently in both dedup and error paths. Reset `v2_status` to `graded`, clear `sold_at`/`order_id`.
- **Skip non-stock lines**: Service/NonInventory items and shipping lines should not attempt stock allocation.

### File: `supabase/functions/qbo-webhook/index.ts`

- **Skip upsert when payload unchanged**: If an existing record is `committed` and the payload hash matches, don't reset to `pending`.

## Part 2: Individual Error Resolution UI (unchanged)

### File: `src/pages/admin-v2/DataSyncPage.tsx` + new `src/components/admin-v2/StagingErrorsPanel.tsx`

- Query all landing tables for `status = 'error'` records.
- Per-row actions: **Retry** (reset to `pending`), **Skip** (mark `skipped`), **View Payload** (JSON viewer).

### File: `supabase/functions/admin-data/index.ts`

- Add `retry-landing-record` and `skip-landing-record` actions.

## Part 3: Full Reset — QBO as Absolute Source of Truth (REVISED)

The core principle: **QBO is the canonical master for all transactional data. If a record does not exist in QBO, it should not exist in the app.** Non-QBO-originated records (Stripe orders, eBay orders, eBay payouts) are valid only if they have a corresponding QBO record (sales receipt, deposit, etc.). Orphans without QBO backing are deleted.

### File: `supabase/functions/admin-data/index.ts` — `rebuild-from-qbo` action

**Phase 1: Delete ALL transactional data (not just QBO-originated)**

The current rebuild only deletes orders with `origin_channel IN ('qbo', 'qbo_refund')`. The revised version deletes ALL sales orders, order lines, and stock — regardless of origin channel. This ensures Stripe/eBay/web orders that don't have matching QBO sales receipts are cleaned out.

```text
1. Delete ALL sales_order_line records
2. Delete ALL sales_order records
3. Delete ALL stock_unit records (receipt-linked AND orphans)
4. Delete ALL inbound_receipt_line records
5. Delete ALL inbound_receipt records
6. Delete ALL payout_orders, payout_fee, payout_fee_line records
7. Clean up stale audit_event records from prior processing cycles
```

**Phase 2: Preserve enriched non-transactional data**

These tables are NOT touched:
- `lego_catalog` (products) — enriched with media, descriptions, specs
- `channel_listing` — marketplace listing state
- `media_asset` — product images
- `brickeconomy_*` — market data
- `customer` — customer master (will be reconciled, not deleted)
- `sku` — SKU definitions (will be recreated by processor as needed)

**Phase 3: Reset ALL landing tables to `pending`**

Reset every QBO staging table so the processor replays the full history:
- `landing_raw_qbo_purchase`
- `landing_raw_qbo_sales_receipt`
- `landing_raw_qbo_refund_receipt`
- `landing_raw_qbo_item`
- `landing_raw_qbo_customer`
- `landing_raw_qbo_vendor`
- `landing_raw_qbo_tax_entity`

**Phase 4: Reconcile non-QBO landing tables**

After QBO replay completes, non-QBO orders (Stripe, eBay) that were re-created by the processor from their QBO sales receipt counterparts will exist. Any Stripe/eBay landing records (`landing_raw_stripe_event`, `landing_raw_ebay_order`, `landing_raw_ebay_payout`) should also be reset to `pending` so they can be re-matched against the rebuilt QBO data. Records that cannot match a QBO counterpart after replay are flagged as errors for manual review.

Reset:
- `landing_raw_stripe_event`
- `landing_raw_ebay_order`
- `landing_raw_ebay_payout`
- `landing_raw_ebay_listing`

**Phase 5: Customer reconciliation**

Customers that exist locally but have no `qbo_customer_id` and no local orders (after rebuild) are deleted. Customers with a `qbo_customer_id` are preserved and will be updated from QBO data during replay.

### Summary of changes vs current rebuild

| Aspect | Current | Revised |
|---|---|---|
| Sales orders deleted | Only `origin_channel IN ('qbo', 'qbo_refund')` | ALL sales orders |
| Stock units deleted | Only receipt-linked + orphans without receipt | ALL stock units |
| Payouts/fees | Not touched | Deleted (rebuilt from eBay/Stripe landing data) |
| Non-QBO landing tables | Not touched | Reset to `pending` for re-matching |
| Customers | Not touched | Orphans without QBO ID or orders deleted |
| Products/media/listings | Not touched | Not touched (correct) |

## Deployment

Redeploy: `qbo-process-pending`, `qbo-webhook`, `admin-data`

## Files Modified

1. `supabase/functions/qbo-process-pending/index.ts` — rollback guards, shipping line skip, unified stock reset
2. `supabase/functions/qbo-webhook/index.ts` — skip unchanged payload upserts
3. `supabase/functions/admin-data/index.ts` — retry/skip actions, revised full rebuild
4. `src/pages/admin-v2/DataSyncPage.tsx` — staging errors UI
5. `src/components/admin-v2/StagingErrorsPanel.tsx` — new component

