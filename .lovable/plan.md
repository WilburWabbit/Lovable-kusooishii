

# Fix QBO purchase + item sync from new purchase batches

## Three problems to fix

1. **No QBO Purchase was created for PO-669** because the app has no "create purchase in QBO" path — only a one-way pull (`qbo-sync-purchases`).
2. **QBO Items were created with the MPN as the name** because the form has no name field, so `v2_create_purchase_batch` stores `product.name = mpn`, which `qbo-sync-item` then uses for `Name`, `Description`, and `PurchaseDesc`.
3. **QBO Items are wrong type / missing fields**: created as `NonInventory`, no `PurchaseCost`, no tax code, no inventory start date.

## Fix 1 — Capture product name in the new purchase form

**`src/components/admin-v2/NewPurchaseForm.tsx`**

For each line item, when the typed MPN does NOT match an existing product in `useProducts()`, expand the row to show a required **"Product Name"** input. When the MPN matches an existing product, show the existing name read-only and skip the input.

Pass `name` per line item up to the mutation. `canSubmit` must also require `name` for new MPNs.

**`src/hooks/admin/use-purchase-batches.ts` → `CreateBatchInput`**

Add optional `name?: string` to each line item and forward it in the RPC payload.

**Migration — `v2_create_purchase_batch`**

When upserting `product`, use `COALESCE(NULLIF(elem->>'name',''), v_mpn)` as the insert value, and on conflict update `name` ONLY if the existing row's name equals its mpn (i.e. was a placeholder). This way real names overwrite placeholder names but never overwrite a real one.

## Fix 2 — Push the Purchase to QBO when a batch is created

**New edge function `supabase/functions/v2-push-purchase-to-qbo/index.ts`**

Called fire-and-forget from `useCreatePurchaseBatch` after the RPC succeeds (mirrors the pattern in `use-stock-units.ts` for `qbo-sync-item`). Inputs: `{ batch_id }`.

Steps:

1. Load batch + line items + supplier.
2. `ensure_vendor` already runs in a trigger so `supplier_id` is set; resolve the vendor's QBO `VendorRef.value` (lookup via existing `vendor` table → `qbo_vendor_id`). If missing, call `qbo-upsert-vendor` (already exists pattern via `qbo-sync-vendors`) or fail gracefully and write an audit error.
3. For each line item: resolve `qbo_item_id` for the placeholder grade-5 SKU (`<mpn>.5`). If absent, call `qbo-sync-item` first to create it (with the correct payload from Fix 3 below).
4. Build a QBO **Purchase** payload (`PaymentType: "Cash"` with `AccountRef` = the configured cash/bank account, `TxnDate` = `purchase_date`, `EntityRef` = vendor, `DocNumber` = `batch.id`, `Line[]` = one `ItemBasedExpenseLineDetail` per line item with `ItemRef`, `Qty`, `UnitPrice`, `TaxCodeRef`).
5. POST to `${baseUrl}/purchase?minorversion=65`. On success: store the returned `Id` on the batch (new column `qbo_purchase_id text`) and write an `audit_event`. On error: write the error and the payload to audit, do NOT roll back the local batch — operator can retry.

**Migration — extend `purchase_batches`**

Add `qbo_purchase_id text` and `qbo_sync_status text default 'pending'` (values: `pending | synced | error | skipped`) and `qbo_sync_error text`.

**Repair PO-669**: call the new function once for PO-669 after deploy (one-shot via the BatchDetail "Retry QBO sync" button below). Migration also resets the existing 9 SKUs' `qbo_item_id` to `NULL` so re-sync recreates them with the corrected item payload (Fix 3) — and we must first delete the 9 broken NonInventory items already in QBO. Plan: a small admin action on the BatchDetail page that lists each linked QBO item and deletes them via `${baseUrl}/item?operation=delete` before re-creating.

## Fix 3 — Create QBO Items as Inventory with correct fields

**`supabase/functions/qbo-sync-item/index.ts`**

Change the CREATE branch:

- `Type: "Inventory"` (not `NonInventory`)
- `TrackQtyOnHand: true`
- `QtyOnHand: 0`
- `InvStartDate: "2023-04-14"` (per the user's spec)
- `AssetAccountRef: { value: <inventory_asset_account_id> }`
- `IncomeAccountRef: { value: <sales_income_account_id> }`
- `ExpenseAccountRef: { value: <cogs_account_id> }`
- `PurchaseCost: exVAT(landedCost)` from the SKU's most recent stock_unit `landed_cost` (or `unit_cost` from the line item being processed — see batch-push flow).
- `UnitPrice: exVAT(salePrice)` only when set.
- `SalesTaxCodeRef: { value: "TAX" }` (and on UK accounts the standard 20% code) — keep current `Taxable: true` and add a `PurchaseTaxCodeRef` if the supplier is VAT-registered.
- `Name: '<Product Name> (<SKU>)'`, `Description` and `PurchaseDesc` both = `'<Product Name> (<SKU>)'` per the user's spec.

The current account refs are hardcoded `IncomeAccountRef.value = "1"` / `ExpenseAccountRef.value = "2"`. These need to be configurable. Add three new rows to `pricing_settings` (or a new `qbo_settings` keyed table) for `qbo_inventory_asset_account_id`, `qbo_income_account_id`, `qbo_cogs_account_id`. Surface them in `QboSettingsCard.tsx` as a small form with a one-shot "Discover accounts" button that lists active QBO Accounts via `${baseUrl}/query?query=SELECT * FROM Account` and lets the admin pick one for each role. Until configured, `qbo-sync-item` should fail fast with a clear message rather than silently send `"1"`/`"2"`.

**Update signature**: `qbo-sync-item` currently takes `{ skuCode, oldSkuCode? }`. Add optional `{ purchaseCost?: number, supplierVatRegistered?: boolean }` so the batch-push flow can pass the per-line cost. When omitted (re-grade path), fall back to current behaviour.

## Fix 4 — UI surface for QBO sync state on the batch page

**`src/components/admin-v2/BatchDetail.tsx`**

Header chip showing `qbo_sync_status` (`Synced #1234 / Pending / Error / Not synced`). When `error` or `pending`, show a "Push to QBO" button that calls the new edge function. Show `qbo_sync_error` inline when present.

## Files touched

| File | Change |
|---|---|
| New migration | `purchase_batches` adds `qbo_purchase_id`, `qbo_sync_status`, `qbo_sync_error`; new `qbo_account_settings` table or pricing_settings rows; updated `v2_create_purchase_batch` to use `name` from input and protect existing real names |
| New edge fn `v2-push-purchase-to-qbo` | Build + POST QBO Purchase, store id back on batch, audit |
| `supabase/functions/qbo-sync-item/index.ts` | Inventory type, configurable account refs, PurchaseCost, tax codes, fail-fast on missing config |
| `src/components/admin-v2/NewPurchaseForm.tsx` | Per-line "Product Name" field for new MPNs; required validation |
| `src/hooks/admin/use-purchase-batches.ts` | Forward `name` per line item; fire-and-forget call to `v2-push-purchase-to-qbo` after RPC success |
| `src/components/admin-v2/BatchDetail.tsx` | QBO sync status chip + "Push to QBO" / "Retry" button + error display |
| `src/components/admin-v2/QboSettingsCard.tsx` | Account-picker form for inventory asset / income / COGS accounts |
| One-shot repair (BatchDetail action) | Delete the 9 wrong NonInventory items in QBO, clear their `qbo_item_id` on SKUs, then push PO-669 + recreate items as Inventory |

## Verification

1. Settings → QBO: configure inventory asset, income, COGS accounts.
2. Create a new purchase batch with a brand-new MPN — name field appears, required.
3. After submit: batch row has `qbo_sync_status='synced'` and `qbo_purchase_id` set; QBO shows a Cash Purchase with the supplier as vendor, `DocNumber = PO-NNN`, one line per MPN with the correct unit cost and tax code.
4. QBO Items for each new MPN exist as **Inventory** with name `<Name> (<SKU>)`, description and purchase description identical, `PurchaseCost` = ex-VAT line unit cost, `QtyOnHand=0`, `InvStartDate=2023-04-14`, asset/income/COGS account refs from settings.
5. Repair PO-669 from BatchDetail → "Retry QBO sync".

