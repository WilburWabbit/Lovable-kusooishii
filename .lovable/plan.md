

## Plan: Wishlist with Catalog Search and Cascading Filters

### Summary
Build the wishlist tab on the Account page with a "Find a Set" catalog search featuring interdependent Theme / Subtheme / Year dropdowns, free-text search, a results table, and add/remove wishlist functionality. Requires a schema update to store subtheme and image URL data, a re-import of the CSV, and a new server-side search function.

### 1. Database Migration

**Add columns to `catalog_product`:**
- `subtheme_name` (text, nullable) — from CSV column 5
- `img_url` (text, nullable) — from CSV column 3

**Create RPC `search_catalog_for_wishlist`** (SECURITY DEFINER, stable):
- Parameters: `search_term text`, `filter_theme text`, `filter_subtheme text`, `filter_year int`
- Returns: `product_id, mpn, name, theme_name, subtheme_name, release_year, img_url`
- Joins `catalog_product` → `theme` (left join)
- Applies all filters with AND logic
- Limits to 100 results, ordered by name
- No stock/SKU join needed — this searches the full catalog

**Create RPC `catalog_filter_options`** (SECURITY DEFINER, stable):
- Parameters: `search_term text`, `filter_theme text`, `filter_subtheme text`, `filter_year int`
- Returns: three arrays — `themes text[]`, `subthemes text[]`, `years int[]`
- Applies all OTHER active filters to compute valid options for each dropdown
- e.g. if theme="Castle" is selected, subthemes returns only subthemes within Castle; years returns only years that have Castle sets

This is the key to cascading: each dropdown's options are constrained by the other filters.

### 2. Update Import Function

Update `supabase/functions/import-sets/index.ts` to:
- Map `cols[3]` → `img_url`
- Map `cols[5]` → `subtheme_name`
- Use upsert on `mpn` instead of delete-all + insert to preserve any manually added products

### 3. Re-run Import

After deploying the updated function and migration, invoke the edge function to re-import with the new columns populated.

### 4. Frontend: Wishlist Tab Rewrite

Rewrite the wishlist tab in `AccountPage.tsx` (extract to a separate component `src/components/WishlistTab.tsx` for clarity):

**"Find a Set" section:**
- Free-text search input (debounced 300ms)
- Three `<Select>` dropdowns: Theme, Subtheme, Year — each populated from `catalog_filter_options` RPC
- Selecting any filter re-fetches both the filter options and search results
- Results displayed in a table: thumbnail (img_url), Set #, Name, Theme, Subtheme, Year, heart button
- Heart button adds the product to the user's wishlist

**"Your Wishlist" section:**
- Shows all wishlist items with product details (joined via catalog_product)
- Red heart button to remove items
- Count badge on the Wishlist tab trigger

**Data flow:**
- `useQuery(["wishlist_filter_options", ...filters])` → calls `catalog_filter_options`
- `useQuery(["wishlist_search", ...filters])` → calls `search_catalog_for_wishlist`
- `useQuery(["my_wishlist"])` → fetches `wishlist_item` with `catalog_product` join
- Add: insert into `wishlist_item` with the user's wishlist ID
- Remove: delete from `wishlist_item` by ID

### Files Changed
- `supabase/migrations/[new].sql` — add columns + RPCs
- `supabase/functions/import-sets/index.ts` — capture subtheme + img_url
- `src/components/WishlistTab.tsx` — new component
- `src/pages/AccountPage.tsx` — import and use WishlistTab

