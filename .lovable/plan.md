

## Add QBO Doc Number & Fix Missing VAT on Orders

### Problem
1. **Missing VAT**: Some order lines still have `tax_code_id = NULL` — the backfill's 20-second time budget means it can't process all ~370 orders in one sync run. Each run only fixes a few before timing out.
2. **No Doc Number**: The QBO Sales Receipt number (e.g. `06-14342-00423`) isn't stored as a discrete field — it's only embedded in the `notes` text. The UI shows the internal `KO-0000XXX` order number instead.

### Plan

#### 1. Database Migration
- Add `doc_number text` column to `sales_order`
- Backfill from `notes` field using regex pattern `#(.+?) on` (extracts the DocNumber from "Imported from QBO SalesReceipt #06-14342-00423 on 2026-03-08")

```sql
ALTER TABLE public.sales_order ADD COLUMN doc_number text;

UPDATE public.sales_order
SET doc_number = (regexp_match(notes, '#(.+?) on '))[1]
WHERE notes IS NOT NULL
  AND notes ~ '#.+? on '
  AND doc_number IS NULL;
```

#### 2. Edge Function: `qbo-sync-sales`
- Store `receipt.DocNumber` into `doc_number` during insert for both `processSalesReceipt` and `processRefundReceipt`
- Increase backfill time budget from 20s to 45s so more orders get VAT resolved per sync run

#### 3. Edge Function: `admin-data`
- Add `doc_number` to the `list-orders` select clause

#### 4. Frontend: `OrdersPage.tsx`
- Add `doc_number` to `OrderRow` type
- Replace the `order_number` column with `doc_number` as the primary column, labelled "Sales Receipt"
- Keep `order_number` as a secondary optional column
- Update `renderCell` and `getSortValue` for the new column
- Update search filter to include `doc_number`

### Files Changed
| File | Change |
|------|--------|
| Migration SQL | Add `doc_number` column + backfill |
| `supabase/functions/qbo-sync-sales/index.ts` | Store `DocNumber`, increase backfill budget |
| `supabase/functions/admin-data/index.ts` | Include `doc_number` in select |
| `src/pages/admin/OrdersPage.tsx` | New primary column, type update, search update |

