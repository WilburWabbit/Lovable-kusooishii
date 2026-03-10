

## QBO TaxCode vs TaxRate — Investigation Results and Proposal

### How QBO Models Tax

QBO uses a **two-tier** tax system:

```text
Transaction Line
  └─ TaxCodeRef (e.g. "3" = "20.0% S")
       └─ TaxCode entity
            ├─ SalesTaxRateList  → [TaxRate ID 4 @ 20%]
            └─ PurchaseTaxRateList → [TaxRate ID 3 @ 20%]
                                        └─ TaxRate entity (already in our vat_rate table)
```

- **TaxCode**: A grouping applied per-line. It can contain multiple TaxRates (compound tax). A single TaxCode may map to *different* rates for sales vs purchases.
- **TaxRate**: The actual percentage charged by a tax agency. This is what we already sync into `vat_rate`.

The line-level `TaxCodeRef` tells QBO *which* TaxCode to apply. QBO then resolves the TaxCode's rate list to compute tax. The transaction-level `TxnTaxDetail.TaxLine[]` array contains the *resolved* results: which TaxRate was used, the net taxable amount, and the tax amount — per rate.

### What We Have Today

| Data | Status |
|------|--------|
| `vat_rate` table (TaxRates) | Synced via `qbo-sync-tax-rates` |
| `qbo_tax_code_ref` on receipt/order lines | Stored but unresolvable — no TaxCode table |
| `TxnTaxDetail.TaxLine` (resolved tax per rate) | Stored in `raw_payload` but not extracted |

### What We Need

**1. New `tax_code` table** — to store QBO TaxCode entities and their rate mappings:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Internal ID |
| `qbo_tax_code_id` | text UNIQUE | QBO TaxCode ID (what `qbo_tax_code_ref` references) |
| `name` | text | e.g. "20.0% S", "Exempt" |
| `active` | boolean | Whether active in QBO |
| `sales_tax_rate_id` | uuid FK → vat_rate | Primary sales TaxRate |
| `purchase_tax_rate_id` | uuid FK → vat_rate | Primary purchase TaxRate |
| `synced_at` | timestamptz | Last sync time |

This allows resolving any line's `qbo_tax_code_ref` → TaxCode → appropriate TaxRate → percentage.

**2. Update `qbo-sync-tax-rates`** (or create a new `qbo-sync-tax-codes` function) to also query `SELECT * FROM TaxCode` and upsert into `tax_code`, resolving `SalesTaxRateList` and `PurchaseTaxRateList` entries to our `vat_rate` rows.

**3. Add `tax_code_id` FK on line tables** — replace the raw text `qbo_tax_code_ref` with a proper FK `tax_code_id uuid REFERENCES tax_code(id)` on both `inbound_receipt_line` and `sales_order_line` (keep the text column for backward compat, add the FK alongside).

### Tax Calculation at Stock Unit Level

Once TaxCode → TaxRate resolution is in place, the chain becomes:

```text
stock_unit
  └─ linked via inbound_receipt_line (for purchase tax)
  └─ linked via sales_order_line (for sales tax)
       └─ tax_code_id → tax_code
            └─ sales_tax_rate_id / purchase_tax_rate_id → vat_rate.rate_percent
```

For purchases: use `tax_code.purchase_tax_rate_id` to get the purchase VAT rate.
For sales: use `tax_code.sales_tax_rate_id` to get the sales VAT rate.

### Implementation Steps

1. **Database migration**: Create `tax_code` table with RLS policies (staff-managed, public-readable like `vat_rate`).
2. **New or extended sync function**: Query QBO `TaxCode` entities, resolve their `SalesTaxRateList`/`PurchaseTaxRateList` to `vat_rate` rows, upsert into `tax_code`.
3. **Update purchase sync**: After upserting lines, resolve `qbo_tax_code_ref` → `tax_code.id` and store `tax_code_id` on `inbound_receipt_line`.
4. **Update sales sync**: Same for `sales_order_line`.
5. **UI**: Add TaxCode sync button alongside TaxRate sync on the VAT settings page.

### Scope Note

This is purely a data-model and sync change. No UI changes to Intake/Inventory/Orders are included — those would be a follow-up once the data linkage is solid.

