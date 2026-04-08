

# Fix: Auto-generate Default Listing Titles in ChannelsTab

## Problem

The `ChannelsTab` component only receives `variants` (SKU-level data) but not the parent `product`. When no existing listing exists, the title field initializes as an empty string — the user has to manually type it every time. Previously there was logic to auto-generate:
- **eBay**: `LEGO <set_number> <product_name>` truncated to 80 characters
- **Other channels**: `<product_name>` as the default

## Changes

### 1. `src/components/admin-v2/ProductDetail.tsx`

Pass the `product` object to `ChannelsTab`:

```tsx
{activeTab === "channels" && <ChannelsTab variants={product.variants} product={product} />}
```

### 2. `src/components/admin-v2/ChannelsTab.tsx`

**A) Update props** to accept `product`:

```tsx
import type { ProductVariant, Product, Channel, ChannelListing } from "@/lib/types/admin";

interface ChannelsTabProps {
  variants: ProductVariant[];
  product: Product;
}
```

Pass `product` down to `VariantChannelsCard`.

**B) Generate default titles** in the initial state builder (line 63-64):

```tsx
// Build default title based on channel
function defaultTitle(ch: Channel, product: Product): string {
  if (ch === "ebay") {
    const raw = `LEGO ${product.setNumber ?? product.mpn} ${product.name}`;
    return raw.length > 80 ? raw.slice(0, 80) : raw;
  }
  return product.name;
}
```

Use it in the initializer:

```tsx
title: existing?.listingTitle ?? defaultTitle(ch.key, product),
```

This means new listings will pre-populate with the correct channel-specific title, while existing listings keep their saved title.

## Files changed

| File | Change |
|------|--------|
| `src/components/admin-v2/ChannelsTab.tsx` | Add `product` prop; generate channel-aware default titles |
| `src/components/admin-v2/ProductDetail.tsx` | Pass `product` to `ChannelsTab` |

