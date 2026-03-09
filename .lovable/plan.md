

## Wire Up Inventory Page

### Approach
Replace the `InventoryPage` placeholder in `AdminPages.tsx` with a dedicated `src/pages/admin/InventoryPage.tsx` that queries `stock_unit` joined with `sku` and `catalog_product` to display a table of all stock units. Follow the same patterns as `IntakePage` (BackOfficeLayout, react-query, same table/card/badge components).

### Data Query
Query `stock_unit` selecting: `id, mpn, condition_grade, status, landed_cost, carrying_value, accumulated_impairment, created_at`, plus joined `sku(sku_code, catalog_product_id, catalog_product:catalog_product(name))`. Order by `created_at desc`.

### UI Layout
- **Summary cards** at top: Total Units, Total Carrying Value, units by status (received / available / reserved / sold)
- **Filters row**: status dropdown, condition grade dropdown, text search on MPN/SKU code
- **Table columns**: SKU Code | Product Name | MPN | Grade | Status | Landed Cost | Carrying Value | Impairment | Created
- Status badges color-coded: received=blue, available=green, reserved=yellow, sold=gray, damaged=red
- Client-side filtering and sorting to start (no pagination needed until scale warrants it)

### Files Changed
1. **Create `src/pages/admin/InventoryPage.tsx`** — full page component with query, filters, summary cards, and table
2. **Update `src/pages/admin/AdminPages.tsx`** — remove `InventoryPage` placeholder export
3. **Update `src/App.tsx`** — import from new file instead of `AdminPages`

### Scope
- 1 new file, 2 minor import updates
- No database changes needed; existing RLS policies on `stock_unit` already allow staff SELECT

