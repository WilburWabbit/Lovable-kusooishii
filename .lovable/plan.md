

## Build Orders Admin Page

### Changes

**1. `supabase/functions/admin-data/index.ts`** — Add `list-orders` action:
- Query `sales_order` with nested `sales_order_line` (including `sku:sku_id(sku_code, name, catalog_product:catalog_product_id(name))`)
- Order by `created_at` descending, limit 1000
- Return order header fields: `id, order_number, origin_channel, origin_reference, status, merchandise_subtotal, gross_total, currency, guest_name, guest_email, created_at, notes` plus line count

**2. New `src/pages/admin/OrdersPage.tsx`** — Full page following InventoryPage pattern:
- **Summary cards**: Total Orders, Total Revenue (sum of `gross_total`), Sales count, Refunds count
- **Filters**: Search (order number, origin reference), origin channel dropdown (`all`, `web`, `qbo`, `qbo_refund`), status dropdown
- **Table columns**: Order #, Origin, Reference, Status, Items (line count), Subtotal, Total, Date
- Origin channel badges with color coding: `web` = blue, `qbo` = emerald, `qbo_refund` = red
- Expandable row or detail view showing order lines with SKU code, product name, qty, unit price, line total

**3. `src/pages/admin/AdminPages.tsx`** — Remove `OrdersPage` placeholder, export from new file

**4. `src/App.tsx`** — Import `OrdersPage` from new file instead of `AdminPages`

### Data shape from API
```typescript
type OrderRow = {
  id: string;
  order_number: string;
  origin_channel: string;
  origin_reference: string | null;
  status: string;
  merchandise_subtotal: number;
  gross_total: number;
  currency: string;
  guest_name: string | null;
  guest_email: string | null;
  created_at: string;
  notes: string | null;
  sales_order_line: OrderLineRow[];
};
```

