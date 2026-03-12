

## Replace Homepage Placeholders with Real Product Images

### Problem
The homepage "Latest arrivals" section uses a hardcoded `featuredSets` array with no images — just showing the set number as placeholder text. Both the homepage and browse page lack product images.

### Plan

**1. Database migration — add `img_url` to `browse_catalog` return**

Update the `browse_catalog` function to also return `p.img_url` so both the homepage and browse page can display the product's primary image.

```sql
-- Add img_url to the return table and SELECT
RETURNS TABLE(
  product_id uuid, mpn text, name text, theme_name text, theme_id uuid,
  retired_flag boolean, release_year integer, piece_count integer,
  min_price numeric, best_grade text, total_stock bigint,
  img_url text  -- NEW
)
```

**2. `src/pages/Index.tsx` — replace hardcoded data with live query**

- Remove the `featuredSets` mock array
- Add a `useQuery` call to `browse_catalog` (no filters, limit 6 via `.slice(0, 6)`) to fetch real featured products
- Replace the placeholder `<div>` with an `<img>` when `img_url` is available, falling back to the set number text when no image exists
- Add a loading skeleton state

**3. `src/pages/BrowsePage.tsx` — show images in product grid**

- Same image treatment: display `img_url` when available, fall back to set number text

### Scope

| File | Change |
|------|--------|
| Migration SQL | Add `img_url` to `browse_catalog` return |
| `src/pages/Index.tsx` | Replace mock data with DB query; render product images |
| `src/pages/BrowsePage.tsx` | Render product images in grid cards |

