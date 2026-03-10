

## Sortable, Filterable, Configurable Admin Tables with Persistence

### Approach

Create a shared infrastructure that every admin table uses, then retrofit each page.

### 1. New shared hook: `useTablePreferences`

A generic hook persisted to `localStorage`, keyed by a unique table ID (e.g. `"admin-inventory"`).

Stores and restores:
- **Sort**: `{ key: string, dir: "asc" | "desc" }`
- **Filters**: `Record<string, string>` (filter key → selected value)
- **Visible columns**: `string[]` (ordered list of visible column keys)
- **Column order**: same array — order = display order

Provides helpers: `toggleSort(key)`, `setFilter(key, value)`, `toggleColumn(key)`, `reorderColumns(from, to)`.

Falls back to a supplied `defaultColumns` array on first load.

### 2. New shared component: `ColumnSelector`

A popover/dropdown triggered by a `Settings2` (or `SlidersHorizontal`) icon button placed next to the filter bar. Shows a checklist of all available columns with drag-to-reorder (or simple up/down arrows to keep it lightweight). Each column has a checkbox for visibility.

### 3. New shared component: `SortableTableHead`

A `<TableHead>` wrapper that accepts `columnKey`, the preferences hook, and renders the sort arrow icon. Clicking toggles sort. Replaces the inline sort logic currently duplicated across pages.

### 4. Shared sort utility

Extract the existing `sortRows` function from `VatRatesSettingsPage` into a shared `src/lib/table-utils.ts` alongside the hook and components.

### 5. Retrofit each admin table

**Pages with data tables to update:**

| Page | Table ID | Columns | Existing Filters to Preserve |
|------|----------|---------|------------------------------|
| InventoryPage | `admin-inventory` | 12 cols (SKU, Product, MPN, Grade, Status, Landed net, VAT %, VAT, Landed inc, Carrying, Impairment, Created) | search, status, grade |
| OrdersPage | `admin-orders` | 10 cols (expand chevron, Order #, Origin, Reference, Status, Items, Net, VAT, Total, Date) | search, channel, status |
| IntakePage | `admin-intake` | 8 cols (QBO ID, Vendor, Date, Net, VAT, Gross, Status, chevron) | none currently — add status filter |
| VatRatesSettingsPage (rates tab) | `admin-vat-rates` | 6 cols | none — already has sort |
| VatRatesSettingsPage (codes tab) | `admin-tax-codes` | 6 cols | none — already has sort |
| UsersSettingsPage | `admin-users` | 4 cols (avatar+name, email, roles, actions) | none — add search |

For each page:
- Define a column config array: `{ key, label, align?, defaultVisible?, render(row) }`
- Replace hardcoded `<TableHead>` with mapped `SortableTableHead` from visible+ordered columns
- Replace hardcoded `<TableCell>` with mapped cells using column render functions
- Wire filters through the hook
- Add `ColumnSelector` to the filter bar

### 6. Persistence details

- Key format: `table-prefs-${tableId}` in `localStorage`
- JSON serialized on every change via a debounced write
- On mount, read and merge with defaults (handles new columns added later gracefully)

### Files to create
- `src/hooks/useTablePreferences.ts` — the persistence hook
- `src/components/admin/SortableTableHead.tsx` — sortable header cell
- `src/components/admin/ColumnSelector.tsx` — column visibility/order popover
- `src/lib/table-utils.ts` — shared `sortRows` function

### Files to modify
- `src/pages/admin/InventoryPage.tsx`
- `src/pages/admin/OrdersPage.tsx`
- `src/pages/admin/IntakePage.tsx`
- `src/pages/admin/VatRatesSettingsPage.tsx`
- `src/pages/admin/UsersSettingsPage.tsx`

