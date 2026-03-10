

## Activate Item Webhook Handler

### Change
Replace the no-op `handleItem` function in `supabase/functions/qbo-webhook/index.ts` with real create/update logic. Delete is ignored since QBO doesn't allow item deletion.

### Logic for Create/Update
1. Fetch the Item by ID from QBO: `GET /item/{entityId}`
2. Extract the `Sku` field and parse it using the existing `parseSku` helper to get `mpn` and `conditionGrade`
3. Build `sku_code` as `{mpn}-G{conditionGrade}`
4. Look up `catalog_product` by `mpn` to get `catalog_product_id`
5. Upsert into the `sku` table on `qbo_item_id`:
   - `qbo_item_id` = QBO Item ID
   - `sku_code` from parsed SKU
   - `name` = cleaned item name (using existing `cleanQboName`)
   - `catalog_product_id` if matched
   - `condition_grade` from parsed SKU
   - `active_flag` = Item.Active
   - `saleable_flag` = true if catalog product exists
   - `price` = Item.UnitPrice (if present)
6. If no `Sku` field on the QBO Item, fall back to parsing the Item Name

### Single file change
**`supabase/functions/qbo-webhook/index.ts`** — replace lines 550-554 (`handleItem` function body).

