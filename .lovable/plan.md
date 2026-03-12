

## Plan: SKU-Centric Pricing Dashboard

### Problem
The pricing dashboard queries `channel_listing`, so it only shows items that have been listed on a channel. The user needs pricing across all products and grades to inform buying and selling decisions, regardless of listing status.

### Approach
Rewrite the data source from `channel_listing` to `sku` as the primary entity. Each row = one SKU (product × grade). Pricing data from `channel_listing` becomes supplementary. Stock counts come from `stock_unit`.

### Data Loading
Query `sku` table with joins:
- `product:product_id(name, mpn)` for product details
- Separate query for stock counts: `stock_unit` grouped by `sku_id` where `status = 'available'`
- Separate query for channel listing pricing: `channel_listing` to pull best/latest floor, target, ceiling per SKU (or keep channel-specific if channel filter is active)

### New Interface

```typescript
interface PricingRow {
  id: string;           // sku.id
  sku_code: string;
  condition_grade: string;
  product_name: string;
  mpn: string;
  stock_qty: number;    // count of available stock_units
  price: number | null; // sku.price (web price)
  price_floor: number | null;
  price_target: number | null;
  price_ceiling: number | null;
  confidence_score: number | null;
  priced_at: string | null;
}
```

### Columns
Remove `channel`, `offer_status`, `listed_price` as primary columns. Add `stock_qty` (Stock) column. Keep floor/target/ceiling/confidence/priced_at. The pricing values shown will be from the best available channel listing for each SKU (or a specific channel if filtered).

### Stock Filter
Add a `Select` dropdown with three options: **In Stock** (default), **Out of Stock**, **All**. State stored in `useState` with `"in_stock"` as initial value -- persists for the session (React state) but resets on page reload, matching the requirement of "persists with whatever filter options the user selected in that session."

Filter logic:
- `in_stock`: `stock_qty > 0`
- `out_of_stock`: `stock_qty === 0`
- `all`: no filter

### Batch Pricing
The "Run All Pricing" button will call `calculate-pricing` for each SKU (not each listing). The action already accepts `sku_id` and `channel`.

### File Changed
`src/pages/admin/PricingDashboardPage.tsx` — full rewrite of data loading, interface, columns, filters, and table rendering.

### Updated Column Definitions
| Column | Source |
|--------|--------|
| Product | `sku → product.name` |
| MPN | `sku → product.mpn` |
| SKU | `sku.sku_code` |
| Grade | `sku.condition_grade` |
| Stock | count of `stock_unit` where `status='available'` |
| Price | `sku.price` |
| Floor £ | best `channel_listing.price_floor` for this SKU |
| Target £ | best `channel_listing.price_target` |
| Ceiling £ | best `channel_listing.price_ceiling` |
| Confidence | best `channel_listing.confidence_score` |
| Priced At | latest `channel_listing.priced_at` |

