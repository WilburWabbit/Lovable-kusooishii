

## Show VAT Details Across Intake, Inventory, and Orders

### Changes Required

#### 1. Database Migration
- Add `inbound_receipt_line_id uuid REFERENCES inbound_receipt_line(id)` to `stock_unit` — needed so inventory can trace back to purchase tax info.

#### 2. Update `process-receipt` Edge Function
- When creating stock units, store the `inbound_receipt_line_id` on each unit so we can trace tax data later.

#### 3. Update `admin-data` Edge Function

**`receipt-lines`**: Join `tax_code_id` → `tax_code` → `purchase_tax_rate_id` → `vat_rate(rate_percent)` so each line returns its purchase VAT rate %.

**`list-orders`**: Add `tax_total` to order select. Join `sales_order_line` → `tax_code` → `sales_tax_rate_id` → `vat_rate(rate_percent)` so each line returns its sales VAT rate %.

**`list-stock-units`**: Join `inbound_receipt_line_id` → `inbound_receipt_line` → `tax_code` → `purchase_tax_rate_id` → `vat_rate(rate_percent)` to get the purchase VAT rate per stock unit.

#### 4. Intake Page (`IntakePage.tsx`)

**Receipts table**:
- Remove "Tax Treatment" column
- Show: Net (computed from total_amount/tax_total/global_tax_calculation) | VAT | Gross (inc VAT)

**Receipt detail lines**:
- Show VAT Rate % (from joined vat_rate), VAT per line (computed from rate), and line gross (inc VAT)

#### 5. Orders Page (`OrdersPage.tsx`)

**Header row**: Show Subtotal (net) | VAT | Total (inc VAT) — using `merchandise_subtotal`, `tax_total`, `gross_total`.

**Expanded line items**: Add VAT % column (from joined vat_rate), rename "Unit Price" → "Unit (net)", add "VAT" and "Line (inc VAT)" columns.

#### 6. Inventory Page (`InventoryPage.tsx`)

- Rename "Landed" → "Landed (net)"
- Add "VAT %" column (from joined purchase vat_rate)
- Add "VAT" column (landed_cost * rate / 100)
- Add "Landed (inc VAT)" column

### Files to Change
- **Migration**: new migration for `inbound_receipt_line_id` on `stock_unit`
- **Edge functions**: `admin-data/index.ts`, `process-receipt/index.ts`
- **UI**: `IntakePage.tsx`, `OrdersPage.tsx`, `InventoryPage.tsx`

