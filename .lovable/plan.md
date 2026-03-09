

## Plan: Connect Browse & Product Detail Pages to Live Data

### Summary
Replace mock data in BrowsePage and ProductDetailPage with real queries against `catalog_product`, `sku`, `stock_unit`, and `theme` tables. Add working search, theme filtering, condition filtering, and retired status filtering. Requires a small migration to add missing columns.

### Database Migration

**Add missing columns:**
- `sku.price` (numeric, nullable) — sale price for the SKU
- `catalog_product.description` (text, nullable) — product description for detail page

**Create a database function `browse_catalog`** (public, no auth required) that returns aggregated browse data efficiently:

```sql
CREATE OR REPLACE FUNCTION public.browse_catalog(
  search_term text DEFAULT NULL,
  filter_theme_id uuid DEFAULT NULL,
  filter_grade text DEFAULT NULL,
  filter_retired boolean DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid, mpn text, name text, theme_name text, theme_id uuid,
  retired_flag boolean, release_year int, piece_count int,
  min_price numeric, best_grade text, total_stock bigint
)
```

This function joins `catalog_product` → `sku` → `stock_unit` (status = 'available'), groups by product, and applies filters. Only returns products with at least one available stock unit. Search uses `ILIKE` on name and mpn.

### Frontend Changes

**1. BrowsePage.tsx** — full rewrite:
- Fetch themes from `theme` table for filter sidebar
- Call `browse_catalog` RPC with filter state (search, theme, grade, retired)
- Use `useState` for filters + debounced search input
- Use `useQuery` for data fetching with filter params as query keys
- Loading skeleton states
- "No results" empty state
- Filters are interactive: clicking a theme/grade/status updates state and re-queries

**2. ProductDetailPage.tsx** — full rewrite:
- Fetch product by MPN: `catalog_product` with theme join
- Fetch SKUs for the product with stock counts via a second query joining `sku` → `stock_unit` (status = 'available'), grouped by SKU
- Use `useQuery` for both queries
- Loading skeleton state
- 404 state if product not found

### Technical Details

The `browse_catalog` function avoids N+1 queries and handles all filtering server-side. Both tables (`catalog_product`, `sku`) already have public SELECT RLS policies, and `stock_unit` is staff-only — so the function needs `SECURITY DEFINER` to read stock counts while only exposing aggregate counts (not individual unit details).

**Files changed:**
- `supabase/migrations/[new].sql` — add price, description columns + browse_catalog function
- `src/pages/BrowsePage.tsx` — rewrite with live data
- `src/pages/ProductDetailPage.tsx` — rewrite with live data

