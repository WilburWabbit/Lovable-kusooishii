

## Mobile-First Admin Pages

### Problem
All admin list pages (Products, Inventory, Orders, Listings, Customers, Intake) use multi-column `<Table>` components that are unusable on mobile. The user's viewport is 500px wide and most admin work happens on phones. The sidebar layout already handles mobile via Sheet, but the page content does not adapt.

### Approach
Adopt a dual-render pattern: show card-based lists on mobile (`md:hidden`), keep tables on desktop (`hidden md:block`). This mirrors the storefront's responsive card grid. Each admin list page gets a mobile card view alongside its existing table.

### Implementation

#### 1. Shared mobile card wrapper
Create `src/components/admin/MobileListCard.tsx` -- a reusable card component for mobile list items with a consistent layout: primary label, secondary metadata row, badges, and a tap target to navigate/expand.

#### 2. Products page (`ProductsPage.tsx`)
- **Mobile view**: Stacked cards showing MPN, product name, theme, stock count, content indicator, and retired badge. Tap navigates to product detail.
- **Desktop**: Existing table unchanged.
- Filters already stack on mobile (`flex-col sm:flex-row`), keep as-is.
- Hide ColumnSelector on mobile (not relevant for card view).

#### 3. Inventory page (`InventoryPage.tsx`)
- **Mobile cards**: SKU code, product name, status badge, grade, carrying value. 
- **Desktop**: Existing table.

#### 4. Orders page (`OrdersPage.tsx`)
- **Mobile cards**: Order number, channel badge, status badge, gross total, date. Tap expands to show line items as a simple stacked list (not a nested table).
- **Desktop**: Existing table with collapsible rows.

#### 5. Listings page (`ListingsPage.tsx`)
- **Mobile cards**: SKU code, product name, channel badges with status indicators.
- **Desktop**: Existing table.

#### 6. Customers page (`CustomersPage.tsx`)
- **Mobile cards**: Display name, email, city, active badge.
- **Desktop**: Existing table.

#### 7. Intake page (`IntakePage.tsx`)
- **Mobile cards**: Vendor name, date, total, status badge. Tap expands to line items as a stacked list.
- **Desktop**: Existing table.

#### 8. Product Detail page (`ProductDetailAdminPage.tsx`)
- Header already works on mobile. 
- Content form: change `md:grid-cols-2` to single column on mobile (already handled).
- **SKU table**: Replace with stacked SKU cards on mobile, each showing code, grade, price, stock, and channel listing buttons.
- Channel overrides section already uses stacked cards -- no change needed.

#### 9. Dashboard (`Dashboard.tsx`)
- Stats grid already uses `sm:grid-cols-2 lg:grid-cols-4` -- works on mobile.
- No table to convert.

#### 10. BackOfficeLayout padding
- Reduce `p-6` to `p-3 md:p-6` for tighter mobile spacing.

### Pattern
Each page follows this structure:
```text
{/* Mobile card view */}
<div className="md:hidden space-y-3">
  {sorted.map(item => <MobileCard ... />)}
</div>

{/* Desktop table view */}
<div className="hidden md:block">
  <Card><Table>...</Table></Card>
</div>
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/admin/MobileListCard.tsx` | New shared mobile card component |
| `src/components/BackOfficeLayout.tsx` | Reduce mobile padding |
| `src/pages/admin/ProductsPage.tsx` | Add mobile card list |
| `src/pages/admin/InventoryPage.tsx` | Add mobile card list |
| `src/pages/admin/OrdersPage.tsx` | Add mobile card list with expandable line items |
| `src/pages/admin/ListingsPage.tsx` | Add mobile card list |
| `src/pages/admin/CustomersPage.tsx` | Add mobile card list |
| `src/pages/admin/IntakePage.tsx` | Add mobile card list with expandable lines |
| `src/pages/admin/ProductDetailAdminPage.tsx` | Replace SKU table with mobile cards on small screens |

