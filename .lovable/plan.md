

## eBay Order & Inventory Sync with QBO Matching

### Problem
eBay orders already exist in `sales_order` because they were synced from QBO (where the eBay `orderId` is used as the Sales Receipt `DocNumber`). The eBay sync must detect these matches and enrich them — not create duplicates.

### Linking Logic
The eBay order `orderId` (e.g. `09-14334-61098`) equals the QBO `DocNumber` stored in `sales_order.doc_number`. This is the primary match key.

### Plan

#### 1. Database Migration — `channel_listing` table

```sql
CREATE TABLE public.channel_listing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'ebay',
  external_sku text NOT NULL,
  external_listing_id text,
  sku_id uuid REFERENCES public.sku(id),
  listed_price numeric,
  listed_quantity integer,
  offer_status text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel, external_sku)
);
-- RLS: admin/staff only
```

#### 2. New Edge Function: `ebay-sync`

Adapted from Kuso Hub's proven implementation, mapped to this project's schema.

**`sync_orders` action:**
1. Fetch eBay orders via Fulfillment API (`/sell/fulfillment/v1/order`)
2. Pre-fetch all `sales_order` records and build a `doc_number → order` lookup map
3. For each eBay order:
   - **Match found** (`doc_number = ebayOrderId`): Enrich existing record with eBay buyer details (shipping address, buyer username/email/phone) and set `origin_channel` to `'ebay'` if it was `'qbo'`. Store raw eBay payload in notes or a raw_data field. Do NOT overwrite QBO financial data (QBO is the financial master).
   - **No match**: Insert new `sales_order` with `origin_channel = 'ebay'`, `origin_reference = orderId`, `doc_number = orderId`. Map line items to `sales_order_line` via SKU matching (`sku_code`).

**`sync_inventory` action:**
1. Fetch eBay inventory items + offers
2. Upsert into `channel_listing`, auto-link to `sku` by matching `sku_code`

**`push_stock` action:**
1. Count `stock_unit` where `status = 'available'` grouped by `sku_id`
2. Push quantities to eBay via Inventory API for linked `channel_listing` entries

#### 3. UI: `EbaySettingsPanel.tsx`
Add "Sync Orders" and "Sync Inventory" buttons (visible when connected).

#### 4. Frontend: `OrdersPage.tsx`
Add `ebay` to `ORIGIN_COLORS` map.

### Files Changed

| File | Change |
|------|--------|
| Migration SQL | Create `channel_listing` table with RLS |
| `supabase/functions/ebay-sync/index.ts` | New function with order sync (QBO matching), inventory sync, stock push |
| `supabase/functions/admin-data/index.ts` | Add `list-channel-listings` action |
| `src/pages/admin/EbaySettingsPanel.tsx` | Add sync trigger buttons |
| `src/pages/admin/OrdersPage.tsx` | Add `ebay` origin color |

