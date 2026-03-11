

## Fix: QBO Webhook Item Processing Failing

### Root Cause

Two issues found:

1. **Missing unique constraint on `sku.qbo_item_id`** — The `handleItem` webhook handler calls `.upsert({...}, { onConflict: "qbo_item_id" })`, but the `sku` table has no unique constraint on that column. This causes a Postgres error: *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*. The audit log confirms this error occurred for Item ID 376.

2. **Item 200041448 may not have triggered a webhook** — There's no audit trail for this item ID. QBO webhooks can be delayed or missed. After fixing the constraint, you can manually trigger a sync or the next webhook will work.

### Fix

| Change | Detail |
|--------|--------|
| **Database migration** | Add a unique index on `sku.qbo_item_id` (partial — only where `qbo_item_id IS NOT NULL`) to support the upsert's `onConflict` clause |
| **`supabase/functions/qbo-webhook/index.ts`** | Update the `handleItem` upsert to use a two-step approach: first check if a SKU with that `qbo_item_id` exists, then update or insert accordingly. Also fall back to `sku_code` conflict if `qbo_item_id` is new but the SKU code already exists (update the existing SKU with the QBO item ID) |

### Detail on the upsert fix

The safest approach:
- Add `CREATE UNIQUE INDEX sku_qbo_item_id_unique ON sku (qbo_item_id) WHERE qbo_item_id IS NOT NULL`
- Keep the existing upsert logic with `onConflict: "qbo_item_id"` — it will now work
- Add a pre-check: if a SKU with the same `sku_code` already exists but has a different/null `qbo_item_id`, update it with the QBO item ID before upserting, to avoid a `sku_code` unique violation

