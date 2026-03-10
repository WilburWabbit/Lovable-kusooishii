

## Listing Actions on Product Detail Admin Page

### Problem
The product detail admin page shows channel coverage (eBay, BrickLink, BrickOwl, Web) but has no way to **create** listings. Staff need manual triggers to:
1. **List on eBay** — create an eBay inventory item + offer + publish
2. **List on Web storefront** — create a `channel_listing` record with `channel = 'web'` and gate the `browse_catalog` RPC behind it

### Architecture

**eBay listing** uses the Inventory API flow: `PUT /inventory_item/{sku}` → `POST /offer` → `POST /offer/{offerId}/publish`. This will be a new `create_listing` action in `ebay-sync/index.ts`.

**Web listing** is a local-only operation: insert a `channel_listing` row with `channel = 'web'`. The `browse_catalog` and `product_detail_offers` RPCs must then require a web listing to exist for a SKU to appear on the storefront.

### Implementation

#### 1. New `create_listing` action in `ebay-sync/index.ts`

Accepts `{ action: "create_listing", sku_id, listing_title?, listing_description? }`.

Flow:
- Look up the SKU + product data (name, description, weight, dimensions, price, condition, MPN, img_url)
- `PUT /sell/inventory/v1/inventory_item/{sku_code}` with product details, condition, availability (stock count)
- `POST /sell/inventory/v1/offer` with pricing, listing policies, marketplace ID
- `POST /sell/inventory/v1/offer/{offerId}/publish` to make it live
- Upsert `channel_listing` record with the returned listing ID and offer status

#### 2. New `create_web_listing` action in `admin-data/index.ts`

Accepts `{ action: "create-web-listing", sku_id }` and `{ action: "remove-web-listing", sku_id }`.

- Inserts a `channel_listing` row with `channel = 'web'`, `external_sku = sku_code`, `listed_price = sku.price`, `offer_status = 'PUBLISHED'`
- Remove action deletes the row

#### 3. Update `browse_catalog` and `product_detail_offers` RPCs

Add `JOIN channel_listing cl ON cl.sku_id = s.id AND cl.channel = 'web'` so only SKUs with a web listing appear on the storefront.

#### 4. UI — Listing buttons in SKU table

In the SKU table on `ProductDetailAdminPage`, for each channel cell that currently shows "—" (no listing), add a small "List" button. Clicking it:
- **eBay**: calls `ebay-sync` with `action: "create_listing"` and the `sku_id`
- **Web**: calls `admin-data` with `action: "create-web-listing"` and the `sku_id`

For cells that already have a listing, keep the current badge. Optionally add an "Unlist" action for web.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add `create_listing` action (inventory item → offer → publish) |
| `supabase/functions/admin-data/index.ts` | Add `create-web-listing` and `remove-web-listing` actions |
| Database migration | Update `browse_catalog` and `product_detail_offers` RPCs to require `channel_listing` with `channel = 'web'` |
| `src/pages/admin/ProductDetailAdminPage.tsx` | Add "List" buttons per SKU per channel in the SKU table, with loading states and confirmation |

