

## Plan: Products Admin Page

### Overview

New `/admin/products` page using the Orders-style expandable row pattern. Primary row shows key sortable/filterable product data; expanding reveals SKU breakdown, channel listings, and content status. Clicking into a row navigates to a dedicated `/admin/products/:id` detail page for editing content and channel overrides.

### 1. Backend: `list-products` action in `admin-data`

Query `product` table with parallel queries for aggregation (same pattern as `list-listings`):

- **Products**: all from `product` joined with `theme` for theme name
- **SKUs + stock**: `sku` where `product_id` matches, with count of `stock_unit` where status = 'available' and sum of `carrying_value`
- **Sales**: `sales_order_line` joined through `sku` — sum quantity and line_total per product
- **Channel listings**: `channel_listing` joined through `sku` — nested array per product

Returns per product:
```
{ id, mpn, name, theme_name, subtheme_name, piece_count, release_year, retired_flag,
  img_url, product_hook, description, highlights, call_to_action, seo_title, seo_description,
  stock_available, carrying_value, units_sold, revenue,
  skus: [{ id, sku_code, condition_grade, price, stock_available, channel_listings }],
  channel_listings: [{ channel, offer_status, listed_price }] }
```

### 2. `ProductsPage.tsx` — List view

**Summary cards**: Total Products, With Content, In Stock, Listed

**Primary row columns** (sortable):
| Key | Label | Notes |
|-----|-------|-------|
| _expand | | chevron |
| mpn | MPN | mono |
| name | Product | truncated |
| theme | Theme | |
| year | Year | |
| retired | Retired | badge |
| content | Content | filled/empty indicator dots |
| stock | Stock | right-aligned |
| value | Value | right-aligned £ |
| sold | Sold | right-aligned |
| revenue | Revenue | right-aligned £ |

**Expanded section** (same Collapsible pattern as Orders):
- SKU breakdown table: SKU code, grade, price, stock count
- Per-SKU channel listing status (reusing ChannelCell component)
- Content preview: which fields are populated (hook, description, highlights, CTA, SEO title, SEO desc)

**Filters**: search (MPN/name), theme dropdown, retired toggle, content status (all/has content/missing)

**Row click**: navigates to `/admin/products/:id`

### 3. `ProductDetailPage` (admin) — `/admin/products/:id`

A new `src/pages/admin/ProductDetailPage.tsx` (distinct from the storefront one).

**Sections:**
- **Header**: product name, MPN, theme, image, key stats (stock, value, revenue)
- **Common Content** (editable): product_hook, description, highlights, call_to_action, seo_title, seo_description — with character counters, auto-save via new `update-product` action in admin-data
- **Channel Overrides**: one card per channel_listing showing effective title/description with override inputs (listing_title, listing_description). eBay title gets 80-char counter. Saves via new `update-channel-listing` action.
- **SKUs table**: read-only list of SKUs with stock and listing status

### 4. Backend: additional actions in `admin-data`

- `get-product`: single product by ID with full joins (same shape as list-products row)
- `update-product`: update content fields on `product` table (product_hook, description, highlights, call_to_action, seo_title, seo_description)
- `update-channel-listing`: update listing_title, listing_description on `channel_listing`

### 5. Routing & Navigation

- Add routes: `/admin/products` and `/admin/products/:id`
- Add "Products" to sidebar between Inventory and Listings with `Box` icon

### Files

| File | Action |
|------|--------|
| `supabase/functions/admin-data/index.ts` | Add `list-products`, `get-product`, `update-product`, `update-channel-listing` actions |
| `src/pages/admin/ProductsPage.tsx` | New — list page with expandable rows |
| `src/pages/admin/ProductDetailAdminPage.tsx` | New — per-product editor |
| `src/App.tsx` | Add 2 routes |
| `src/components/BackOfficeSidebar.tsx` | Add Products nav item |

