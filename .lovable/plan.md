

## Add "Sync Items" button to QBO Settings

### Overview

Create a new edge function `qbo-sync-items` that queries all Inventory/NonInventory Item records from QBO and upserts them into the `sku` table, reusing the same SKU parsing and upsert logic from the webhook's `handleItem`. Then add a "Sync Items" button to the QBO settings panel.

### Changes

**1. New edge function: `supabase/functions/qbo-sync-items/index.ts`**

- Reuse `ensureValidToken`, `parseSku`, `cleanQboName` (copied from existing functions — same pattern as all other sync functions)
- Query QBO Items via `SELECT * FROM Item WHERE Type IN ('Inventory', 'NonInventory') MAXRESULTS 1000 STARTPOSITION {n}` with pagination
- For each item: parse SKU field (MPN.Grade), resolve product by MPN, then upsert into `sku` table using `onConflict: "qbo_item_id"` — identical logic to `handleItem` in the webhook
- Land raw payloads into `landing_raw_qbo_item` for auditability
- Return counts: `{ total, upserted, linked, skipped_no_mpn }`

**2. Update `supabase/config.toml`** — add `[functions.qbo-sync-items]` with `verify_jwt = false`

**3. Update `src/pages/admin/QboSettingsPanel.tsx`** — add a "Sync Items" button alongside the existing sync buttons, with the same loading/toast pattern

### No database changes needed

The `sku` table and `sku_qbo_item_id_unique` index already exist.

