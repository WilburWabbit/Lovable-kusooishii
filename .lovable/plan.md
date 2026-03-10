

## Plan: Introduce `product` master table, rename `catalog_product` to `lego_catalog`

### Context

Currently `catalog_product` serves dual duty: it's both a LEGO reference catalog and the app's product record. The user wants to separate these concerns:

1. **`lego_catalog`** (renamed from `catalog_product`) — a pure reference table of known LEGO items, used primarily by wishlists and catalog enrichment.
2. **`product`** (new) — the master product table keyed on MPN, which aggregates data from source tables (lego_catalog, brickeconomy_collection) and holds all app-generated creative content (hook, description, highlights, CTA, SEO fields). This is what SKUs, listings, the storefront, and the back-office content editor reference.

The `channel_listing` table will hold channel-specific overrides (e.g. eBay listing title).

### Database changes (single migration)

**Step 1 — Rename `catalog_product` to `lego_catalog`**

```sql
ALTER TABLE catalog_product RENAME TO lego_catalog;
```

This preserves all data, indexes, foreign keys, and RLS policies in place.

**Step 2 — Create `product` table**

```text
product
├── id (uuid, PK)
├── mpn (text, UNIQUE NOT NULL) — canonical key
├── name (text)
├── theme_id (uuid, FK → theme)
├── subtheme_name (text)
├── product_type (text, default 'set')
├── piece_count (integer)
├── release_year (integer)
├── retired_flag (boolean, default false)
├── img_url (text)
├── description (text) — app-mastered long description
├── product_hook (text) — marketing hook
├── call_to_action (text)
├── highlights (text) — bullet highlights
├── seo_title (text)
├── seo_description (text)
├── status (text, default 'active')
├── lego_catalog_id (uuid, FK → lego_catalog, nullable)
├── created_at, updated_at (timestamptz)
```

RLS: readable by all (public SELECT), managed by admin/staff.

**Step 3 — Seed `product` from existing `lego_catalog` rows that have SKUs**

Insert into `product` from `lego_catalog` joined with `sku` where `sku.catalog_product_id IS NOT NULL`, pulling factual fields (name, theme_id, mpn, etc.) and setting `lego_catalog_id` for the back-reference.

**Step 4 — Re-point `sku.catalog_product_id` → `product`**

- Add `sku.product_id (uuid, FK → product)` column
- Populate it from the seeded product records by MPN match
- For SKUs without a catalog match (standalone items), create product rows from SKU data
- Drop `sku.catalog_product_id` after migration

**Step 5 — Add content columns to `channel_listing`**

```sql
ALTER TABLE channel_listing
  ADD COLUMN listing_title text,
  ADD COLUMN listing_description text;
```

**Step 6 — Update `wishlist_item` FK**

`wishlist_item.catalog_product_id` stays pointing at `lego_catalog` (now renamed). The FK reference updates automatically with the rename. No schema change needed here.

**Step 7 — Recreate DB functions**

Rebuild these four functions to reference `lego_catalog` (for wishlist) and `product` (for storefront):
- `browse_catalog` — query `product` + `sku` + `stock_unit`
- `product_detail_offers` — query `product` + `sku` + `stock_unit`
- `search_catalog_for_wishlist` — query `lego_catalog` (unchanged logic, new table name)
- `catalog_filter_options` — query `lego_catalog` (unchanged logic, new table name)

### Code changes

**Edge functions** (6 files referencing `catalog_product`):
- `admin-data/index.ts` — change `catalog_product` → `product`, update `catalog_product_id` → `product_id` in all select/join queries
- `qbo-webhook/index.ts` — look up `product` by MPN instead of `catalog_product`
- `qbo-sync-purchases/index.ts` — same
- `process-receipt/index.ts` — same
- `import-sets/index.ts` — upsert into `lego_catalog` instead of `catalog_product`
- `sync-media-from-hub/index.ts` — update `product.img_url` instead of `catalog_product`

**Frontend** (5 files):
- `ProductDetailPage.tsx` — query `product` table instead of `catalog_product`
- `BrowsePage.tsx` — no change (uses `browse_catalog` RPC which will be updated)
- `WishlistTab.tsx` — no change (uses RPCs and `wishlist_item` FK, table rename is transparent)
- `ListingsPage.tsx` — update `catalog_product` type references to `product`
- `OrdersPage.tsx` — update `catalog_product` references in types
- `IntakePage.tsx` — query `product` instead of `catalog_product`
- `admin-data/index.ts` — update all join references from `catalog_product` to `product`

### What this does NOT include

- Full `content_document` / `content_revision` versioning (deferred, start with flat columns)
- Content editor UI (separate task after schema is in place)
- AI copy generation
- Populating product_hook/highlights/seo fields (empty initially)

### Risk notes

- The rename is safe — Postgres `ALTER TABLE RENAME` preserves all constraints, indexes, and FK references automatically
- The `sku.catalog_product_id` → `sku.product_id` migration must be done carefully to avoid breaking running queries; we'll add the new column first, populate it, then drop the old one
- The auto-generated `types.ts` will update after migration

