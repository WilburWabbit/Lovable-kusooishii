

## Plan: Add Row-Click Navigation to Listings and Pricing Pages

### Problem
- **Listings page**: Rows are not clickable -- no navigation to product detail on click.
- **Pricing page**: Rows are not clickable -- no navigation to product detail on click. Also lacks a mobile card view.

### Changes

#### 1. Listings Page (`src/pages/admin/ListingsPage.tsx`)
- Import `useNavigate` from react-router-dom
- Add `onClick` to each `MobileListCard` to navigate to `/admin/products/${r.product_id}` (need to pass product_id through the data)
- Add `onClick` and `cursor-pointer` to each desktop `TableRow` to navigate to the product detail page
- If the listing row doesn't carry `product_id`, update the data query to include it from the SKU's product reference

#### 2. Pricing Page (`src/pages/admin/PricingDashboardPage.tsx`)
- Import `useNavigate` from react-router-dom
- Track `product_id` in the `PricingRow` interface (sourced from the SKU query which already joins `product:product_id(...)`)
- Add `onClick` and `cursor-pointer` to each `TableRow` to navigate to `/admin/products/${row.product_id}`
- Add a mobile card view (`md:hidden`) matching the pattern used by other admin pages, with navigation on tap

#### 3. Data: Ensure product_id is available
- **Pricing**: The SKU query already fetches `product:product_id(name, mpn)`. Add `product_id` to the select and map it into `PricingRow`.
- **Listings**: Similarly ensure `product_id` is available from the SKU data and mapped into `ListingRow`.

### Navigation Target
All rows navigate to `/admin/products/:productId` since that is the existing product detail editor.

