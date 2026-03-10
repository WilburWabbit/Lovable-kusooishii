

## Fix: Restore eBay/Web Listing Actions on Mobile SKU Cards

### Problem
The mobile SKU cards on the Product Detail admin page (lines 502-527) only display channel badges for existing listings. The desktop table (lines 552-617) has "List" buttons for eBay and Web on unlisted channels, plus a remove button for Web listings. These actions are completely missing from the mobile view.

### Fix

Update the mobile SKU card view in `src/pages/admin/ProductDetailAdminPage.tsx` to include the same listing actions:

1. **For each channel in each SKU card**, render the same logic as desktop:
   - If a listing exists: show the status badge + remove button (for Web)
   - If no listing exists and channel is `ebay` or `web`: show a "List on eBay" / "List on Web" button
   - Otherwise: show dash

2. **Layout**: Replace the current simple badge row with a channel actions row. Each channel gets a small inline button or badge, laid out in a `flex-wrap` row. The buttons use the same `invokeWithAuth` calls and `listingAction` state as desktop.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/ProductDetailAdminPage.tsx` | Add List/Remove buttons to mobile SKU cards (lines 502-527) |

