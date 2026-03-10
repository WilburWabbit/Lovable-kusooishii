

## Fix Orders Table: VAT Figures and Transaction Dates

### Two Issues

**1. VAT/Net/Total in table rows are wrong**
The table row displays `o.tax_total`, `o.merchandise_subtotal`, and `o.gross_total` from the `sales_order` record. These order-level values were stored incorrectly during sync (e.g. `tax_total = 0`) because QBO's `TxnTaxDetail.TotalTax` was absent or zero for TaxInclusive transactions. Meanwhile, the expanded line items correctly resolve VAT via `tax_code → sales_tax_rate → rate_percent`.

**Fix**: Compute the table-row Net/VAT/Total from line-level data in the frontend, matching what the expanded view already shows correctly. This avoids needing to backfill order-level figures.

In `OrdersPage.tsx`:
- Change `renderCell` for `net`: sum `line_total` across lines
- Change `renderCell` for `vat`: sum `lineVatAmount()` across lines  
- Change `renderCell` for `total`: sum `(line_total + vat)` across lines
- Update summary card totals to use the same line-based calculation

**2. Dates are wrong for all records**
`sales_order` has no `txn_date` column — only `created_at`, which is when the sync ran, not the actual QBO transaction date. The actual `TxnDate` from QBO is captured during sync but only stored in the `notes` field.

**Fix**: Add a `txn_date` column to `sales_order`, populate it during sync, backfill existing records by parsing the date from the notes field, and display it in the Orders table.

### Changes

| Action | File |
|--------|------|
| Migration | Add `txn_date date` column to `sales_order`; backfill by extracting date from `notes` field (pattern: `on YYYY-MM-DD`) |
| Modify | `supabase/functions/qbo-sync-sales/index.ts` — set `txn_date` on insert for both sales and refund receipts |
| Modify | `supabase/functions/admin-data/index.ts` — include `txn_date` in `list-orders` select |
| Modify | `src/pages/admin/OrdersPage.tsx` — compute Net/VAT/Total from lines; display `txn_date` instead of `created_at` for date column |

### Migration SQL

```sql
ALTER TABLE public.sales_order ADD COLUMN txn_date date;

-- Backfill from notes field which contains "on YYYY-MM-DD"
UPDATE public.sales_order
SET txn_date = (regexp_match(notes, 'on (\d{4}-\d{2}-\d{2})'))[1]::date
WHERE notes IS NOT NULL
  AND notes ~ 'on \d{4}-\d{2}-\d{2}'
  AND txn_date IS NULL;
```

