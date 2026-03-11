

## Fix: Missing unique index on `sku.qbo_item_id`

### Problem

The `qbo-webhook` Item handler upserts into the `sku` table with `onConflict: "qbo_item_id"`, but there is no unique constraint or index on that column. This causes every Item webhook to fail with:

> `there is no unique or exclusion constraint matching the ON CONFLICT specification`

The code comment on line 617 even says "unique index on qbo_item_id exists" — but it was never created (or was dropped).

### Separate issue: Item 200041549

QBO has not sent a webhook notification for item 200041549. Only item 377 appears in the logs. This is a QBO-side issue — possibly the notification was dropped or delayed. Once the constraint fix is deployed, editing and re-saving item 200041549 in QBO should trigger a new webhook.

### Fix

**Database migration** — Add the missing unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS sku_qbo_item_id_unique 
ON public.sku (qbo_item_id) 
WHERE qbo_item_id IS NOT NULL;
```

A partial unique index (excluding NULLs) is correct here since many SKUs won't have a `qbo_item_id`.

No code changes needed — the edge function already expects this index to exist.

### Files changed

| File | Change |
|------|--------|
| Database migration | Add unique partial index on `sku.qbo_item_id` |

