

# Add Reconcile Functions for Purchases, Sales, Customers, Items, and Vendors

## What this does

Adds five new reconciliation actions alongside the existing "Reconcile Stock" button. Each compares the app's canonical data against live QBO data and reports discrepancies (with optional auto-correction where safe).

## Design

Each reconciliation follows the same pattern as `reconcile-stock`:
1. Refresh QBO token if needed
2. Query QBO for the entity type (paginated)
3. Compare against canonical app table
4. Report discrepancies; apply safe corrections
5. Return summary + detail array

### Reconcile Purchases
- Query QBO: `SELECT * FROM Purchase` (paginated)
- Compare against `inbound_receipt` by `qbo_purchase_id`
- Detect: purchases in QBO but missing from app (not landed/processed), purchases in app but deleted from QBO, line count mismatches, total amount mismatches
- Auto-fix: flag-only (no destructive action) — report discrepancies for manual review

### Reconcile Sales
- Query QBO: `SELECT * FROM SalesReceipt` (paginated)
- Compare against `sales_order` by `qbo_sales_receipt_id`
- Detect: sales receipts in QBO without a matching order, orders with QBO ref that no longer exist in QBO, total amount mismatches, channel attribution mismatches
- Auto-fix: flag-only

### Reconcile Customers
- Query QBO: `SELECT * FROM Customer WHERE Active = true` (paginated)
- Compare against `customer` by `qbo_customer_id`
- Detect: QBO customers missing from app, app customers with QBO IDs not found in QBO (stale/deleted), display name mismatches
- Auto-fix: delete stale app customers whose `qbo_customer_id` is not in the QBO result set (matching the approved rebuild behavior)

### Reconcile Items
- Query QBO: `SELECT * FROM Item WHERE Type = 'Inventory'` (paginated)
- Compare against `sku` by `qbo_item_id`
- Detect: QBO items without a matching SKU, SKUs with QBO IDs not in QBO, name/description mismatches
- Auto-fix: flag-only

### Reconcile Vendors
- Query QBO: `SELECT * FROM Vendor WHERE Active = true` (paginated)
- Compare against `vendor` by `qbo_vendor_id`
- Detect: QBO vendors missing from app, app vendors with QBO IDs not in QBO, display name mismatches
- Auto-fix: delete stale app vendors whose `qbo_vendor_id` is not in the QBO result set

## Files to modify

### 1. `supabase/functions/admin-data/index.ts`
Add five new action handlers (`reconcile-purchases`, `reconcile-sales`, `reconcile-customers`, `reconcile-items`, `reconcile-vendors`) following the same structure as `reconcile-stock`:
- QBO token refresh (reuse existing pattern)
- Paginated QBO query
- Load canonical table records
- Cross-reference by external ID
- Build details array with discrepancy info
- Return summary stats

Each returns a consistent shape:
```json
{
  "success": true,
  "correlation_id": "...",
  "total_qbo": 100,
  "total_app": 98,
  "in_sync": 95,
  "missing_in_app": 3,
  "missing_in_qbo": 2,
  "mismatched": 1,
  "auto_fixed": 0,
  "details": [{ "entity": "...", "qbo_id": "...", "issue": "...", "action": "..." }]
}
```

### 2. `src/components/admin-v2/QboSettingsCard.tsx`
- Add state for each reconcile action (busy flag + details)
- Add handler functions calling `invokeWithAuth('admin-data', { action: 'reconcile-X' })`
- Add buttons in the "Process & Reconcile" section: `Reconcile Purchases`, `Reconcile Sales`, `Reconcile Customers`, `Reconcile Items`, `Reconcile Vendors`
- Reuse the existing discrepancy details table pattern but with entity-appropriate columns (entity name/ID, QBO ID, issue description, action taken)

## Scope boundaries
- Reconcile Stock remains unchanged
- No schema migrations needed
- No changes to the rebuild pipeline
- These are read-heavy comparison operations with minimal writes (only customer/vendor cleanup)

