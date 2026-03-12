

## Root Cause: Partial unique index incompatible with PostgREST upsert

The Item webhooks **were received** (items 387, 388, 389 all arrived). They all failed with:

> `there is no unique or exclusion constraint matching the ON CONFLICT specification`

The `sku` table has `sku_qbo_item_id_unique` defined as a **partial** unique index:
```sql
CREATE UNIQUE INDEX sku_qbo_item_id_unique ON public.sku USING btree (qbo_item_id) WHERE (qbo_item_id IS NOT NULL)
```

PostgREST (which powers the Supabase JS client) cannot use partial indexes for `ON CONFLICT`. It requires a **full** unique constraint.

### Fix

**1. Database migration** — Replace the partial unique index with a full unique constraint:

```sql
DROP INDEX IF EXISTS sku_qbo_item_id_unique;
ALTER TABLE public.sku ADD CONSTRAINT sku_qbo_item_id_unique UNIQUE (qbo_item_id);
```

Since `qbo_item_id` is nullable and PostgreSQL treats each NULL as distinct in unique constraints, this is safe — multiple SKUs with `NULL` qbo_item_id are still allowed.

No code changes are needed. Both `handleItem` in `qbo-webhook/index.ts` and `qbo-sync-items/index.ts` already use `onConflict: "qbo_item_id"` correctly — they just need the constraint to actually be usable.

**2. Re-process failed items** — After the migration, click "Sync Items" in QBO settings to pull all items (including 387, 388, 389) and upsert them correctly.

