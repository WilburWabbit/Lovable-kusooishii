

## Audit of Monetary Values and VAT Linkage Across QBO Sync Functions

### Current State

**Purchases (`inbound_receipt` / `inbound_receipt_line`)**:
- `total_amount` = `Purchase.TotalAmt` (may be tax-inclusive or exclusive depending on QBO settings — we don't know which)
- `unit_cost` / `line_total` from line detail — no tax info captured
- No `tax_total`, no `global_tax_calculation`, no VAT rate linkage
- QBO provides: `GlobalTaxCalculation` ("TaxInclusive"/"TaxExcluded"/"NotApplicable"), `TxnTaxDetail.TotalTax`, line-level `TaxCodeRef`

**Sales (`sales_order` / `sales_order_line`)**:
- `tax_total` column exists but always set to `0`
- `merchandise_subtotal` and `gross_total` both set to `TotalAmt` — no tax breakout
- No `global_tax_calculation` stored
- QBO provides the same tax fields on `SalesReceipt` and `RefundReceipt`

**VAT Rate table**: exists with `qbo_tax_rate_id` but nothing links to it yet.

---

### Plan

#### 1. Database Migration

**Add to `inbound_receipt`**:
- `tax_total numeric NOT NULL DEFAULT 0`
- `global_tax_calculation text` — stores "TaxInclusive", "TaxExcluded", or "NotApplicable"

**Add to `inbound_receipt_line`**:
- `qbo_tax_code_ref text` — the QBO TaxCode ID per line

**Add to `sales_order`**:
- `global_tax_calculation text`

**Add to `sales_order_line`**:
- `qbo_tax_code_ref text`
- `vat_rate_id uuid REFERENCES vat_rate(id)` — optional FK linking to our synced VAT rate

#### 2. Update `qbo-sync-purchases`

- Capture `purchase.GlobalTaxCalculation` → `global_tax_calculation`
- Capture `purchase.TxnTaxDetail?.TotalTax ?? 0` → `tax_total`
- Capture line-level `detail.TaxCodeRef?.value` → `qbo_tax_code_ref`
- Resolve the transaction's tax rate from `TxnTaxDetail.TaxLine[0].TaxLineDetail.TaxRateRef.value` and look up `vat_rate` by `qbo_tax_rate_id` (store on receipt if needed later)

#### 3. Update `qbo-sync-sales`

- Capture `receipt.GlobalTaxCalculation` → `global_tax_calculation` on `sales_order`
- Capture `receipt.TxnTaxDetail?.TotalTax ?? 0` → `tax_total` on `sales_order`
- Compute `merchandise_subtotal` correctly: if TaxInclusive, `TotalAmt - TotalTax`; if TaxExcluded, `TotalAmt` (tax is on top); set `gross_total = merchandise_subtotal + tax_total`
- Capture line-level `SalesItemLineDetail.TaxCodeRef?.value` → `qbo_tax_code_ref`
- Look up `vat_rate` by matching the transaction's `TaxRateRef` and store `vat_rate_id` on order lines
- Same treatment for `RefundReceipt`

#### 4. Update `qbo-sync-tax-rates` (minor)

No changes needed — it already syncs all TaxRate entities with `qbo_tax_rate_id`.

### No UI changes needed

This is a backend-only data enrichment. The VAT rates page and sync buttons remain as-is.

