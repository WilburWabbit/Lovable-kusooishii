

## Listings Page — Multi-Channel Listing Orchestration

### Concept
The Listings page shows every SKU and its listing status across all sales channels (eBay, BrickLink, BrickOwl, Web). The core view is a **coverage matrix**: each row is a SKU, each channel column shows whether it's listed, its price, quantity, and sync status. This lets staff spot unlisted SKUs, price mismatches, and stale listings at a glance.

### Data Model
The existing `channel_listing` table already tracks per-channel listings linked to `sku_id`. The page will join `sku` → `catalog_product` for product info and left-join `channel_listing` for each channel. No schema changes needed — the existing tables support this.

### Backend — New `admin-data` action: `list-listings`
Add a `list-listings` action to the `admin-data` edge function that returns:
- All active SKUs with their `sku_code`, `name`, `condition_grade`, `price`, `catalog_product.name`, `catalog_product.mpn`
- Available stock count per SKU (count of `stock_unit` where `status = 'available'`)
- All `channel_listing` rows grouped by `sku_id`

The query will fetch SKUs and channel listings separately, then merge client-side (simpler than a complex join in PostgREST).

### UI Structure

**Summary Cards (top)**
- Total SKUs (active)
- Listed on eBay (count of SKUs with an eBay channel_listing)
- Unlisted (SKUs with stock but zero channel listings)
- Stale Listings (synced_at > 24h ago)

**Filters**
- Search (MPN, SKU code, product name)
- Channel filter (All / eBay / BrickLink / BrickOwl / Web)
- Coverage filter (All / Listed / Unlisted / Partial)

**Table Columns**
| Column | Source |
|--------|--------|
| SKU Code | `sku.sku_code` |
| Product | `catalog_product.name` |
| MPN | `catalog_product.mpn` |
| Grade | `sku.condition_grade` |
| Our Price | `sku.price` |
| Stock | count of available `stock_unit` |
| eBay | channel_listing status badge + price |
| BrickLink | channel_listing status badge + price |
| BrickOwl | channel_listing status badge + price |
| Web | channel_listing status badge + price |
| Last Sync | most recent `synced_at` across listings |

Each channel cell shows a coloured badge: **Listed** (green, with price), **Draft** (yellow), **Not Listed** (grey dash). Uses the standard table infrastructure (SortableTableHead, ColumnSelector, useTablePreferences).

**Actions**
- "Sync eBay" button triggers `ebay-sync` with `action: sync_inventory`
- Future: publish queue for batch listing creation

### Files to Create/Edit

1. **`src/pages/admin/ListingsPage.tsx`** — New full page component (replaces placeholder export in AdminPages.tsx)
2. **`src/pages/admin/AdminPages.tsx`** — Remove `ListingsPage` placeholder, re-export from new file
3. **`src/App.tsx`** — Update import to use new ListingsPage
4. **`supabase/functions/admin-data/index.ts`** — Add `list-listings` action (fetch SKUs + channel_listings + stock counts)

### Implementation Notes
- Channel cells will be rendered as compact badges showing offer_status and listed_price
- The "coverage" filter will check whether a SKU has any channel_listing rows
- Stock count will be fetched as a separate aggregation query and merged by sku_id
- Follows the exact same patterns as InventoryPage (useQuery → admin-data, useTablePreferences, SortableTableHead, ColumnSelector)

